import { Platform } from 'react-native';
import { RuntimeConfig } from '../domain/models';
import { apiClient } from '../data/apiClient';
import { readAnonymousId, readTelemetryQueue, saveTelemetryQueue } from '../data/storage';
type Properties = Readonly<Record<string, string | number | boolean>>;
type TelemetryConfig = RuntimeConfig['telemetry'];
type QueuedEvent = Readonly<{
  eventId: string;
  name: string;
  screenId: string | null;
  occurredAt: string;
  configVersion: number;
  properties: Properties;
}>;

const maxQueueSize = 200;
const maxFirebaseQueueSize = 100;
const batchSize = 25;
const firebaseDrainSize = 10;
const sendTimeoutMs = 5000;
const flushDelayMs = 2000;
const backoffMs = [2000, 5000, 15000, 30000, 60000] as const;

class Telemetry {
  private config = disabledConfig();
  private configVersion = 0;
  private anonymousId = '';
  private readonly sessionId = createId('session');
  private currentScreen: string | null = null;
  private screenStartedAt = Date.now();
  private queue: QueuedEvent[] = [];
  private firebaseQueue: QueuedEvent[] = [];
  private hydrated = false;
  private flushing = false;
  private drainingFirebase = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private retryIndex = 0;

  async configure(config: RuntimeConfig) {
    this.config = config.telemetry;
    this.configVersion = config.version;
    if (!this.hydrated) {
      this.hydrated = true;
      try {
        const [anonymousId, stored] = await Promise.all([
          readAnonymousId(),
          readTelemetryQueue<QueuedEvent>(),
        ]);
        this.anonymousId = anonymousId;
        this.queue = [...stored.slice(-maxQueueSize), ...this.queue].slice(-maxQueueSize);
      } catch {
        this.anonymousId ||= createId('anonymous');
      }
    }
    this.scheduleFlush(0);
    if (this.canUseFirebase()) {
      void this.configureFirebase().catch(() => undefined);
      this.scheduleFirebaseDrain();
    }
  }

  screen(screenId: string) {
    if (this.currentScreen === screenId) return;
    if (this.currentScreen) {
      this.track('screen_leave', {
        screen_id: this.currentScreen,
        duration_ms: Date.now() - this.screenStartedAt,
      }, this.currentScreen);
    }
    this.currentScreen = screenId;
    this.screenStartedAt = Date.now();
    this.track('screen_view', { screen_id: screenId }, screenId);
  }

  track(name: string, properties: Properties = {}, screenId = this.currentScreen) {
    if (!this.config.enabled) return;
    const event: QueuedEvent = {
      eventId: createId('evt'),
      name,
      screenId,
      occurredAt: new Date().toISOString(),
      configVersion: this.configVersion,
      properties,
    };
    if (this.config.backendEnabled) this.enqueue(event);
    if (this.canUseFirebase() && this.config.analyticsEnabled) {
      if (this.firebaseQueue.length >= maxFirebaseQueueSize) this.firebaseQueue.shift();
      this.firebaseQueue.push(event);
      this.scheduleFirebaseDrain();
    }
  }

  report(error: Error, context: Properties = {}) {
    this.track('app_error', {
      error_name: error.name,
      error_message: error.message.slice(0, 180),
      ...context,
    });
    if (this.canUseFirebase() && this.config.crashlyticsEnabled) {
      void this.sendCrashlytics(error, context).catch(() => undefined);
    }
  }

  async clearRegenerableCache() {
    this.queue = [];
    this.firebaseQueue = [];
    this.retryIndex = 0;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.flushTimer = null;
    this.persistTimer = null;
    await saveTelemetryQueue([]);
  }

  private enqueue(event: QueuedEvent) {
    if (this.queue.length >= maxQueueSize) this.queue.shift();
    this.queue.push(event);
    this.schedulePersist();
    this.scheduleFlush(flushDelayMs);
  }

  private scheduleFlush(delay: number) {
    if (this.flushing || this.flushTimer || !this.queue.length) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, delay);
  }

  private async flush() {
    if (this.flushing || !this.queue.length || !this.config.backendEnabled) return;
    this.flushing = true;
    const batch = this.queue.slice(0, batchSize);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), sendTimeoutMs);
    try {
      await apiClient.telemetry({
        anonymousId: this.anonymousId || 'anonymous-pending',
        sessionId: this.sessionId,
        events: batch,
      }, controller.signal);
      this.queue.splice(0, batch.length);
      this.retryIndex = 0;
      this.schedulePersist();
    } catch {
      this.retryIndex = Math.min(this.retryIndex + 1, backoffMs.length - 1);
    } finally {
      clearTimeout(timeout);
      this.flushing = false;
      const delay = this.queue.length ? backoffMs[this.retryIndex] : 0;
      if (this.queue.length) this.scheduleFlush(withJitter(delay));
    }
  }

  private schedulePersist() {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void saveTelemetryQueue(this.queue.slice(-maxQueueSize)).catch(() => undefined);
    }, 1000);
  }

  private scheduleFirebaseDrain() {
    if (this.drainingFirebase || !this.firebaseQueue.length) return;
    this.drainingFirebase = true;
    setTimeout(() => void this.drainFirebase(), 0);
  }

  private async drainFirebase() {
    const events = this.firebaseQueue.splice(0, firebaseDrainSize);
    try {
      for (const event of events) {
        await this.sendFirebaseEvent(event.name, event.properties);
      }
    } catch {
      // Firebase is a best-effort secondary sink.
    } finally {
      this.drainingFirebase = false;
      if (this.firebaseQueue.length) {
        setTimeout(() => this.scheduleFirebaseDrain(), flushDelayMs);
      }
    }
  }

  private canUseFirebase() {
    return this.config.firebaseMode === 'client_direct'
      && (Platform.OS === 'ios' || Platform.OS === 'android');
  }

  private async configureFirebase() {
    try {
      const analytics = await import('@react-native-firebase/analytics');
      await analytics.setAnalyticsCollectionEnabled(
        analytics.getAnalytics(),
        this.config.analyticsEnabled,
      );
      const crash = await import('@react-native-firebase/crashlytics');
      await crash.setCrashlyticsCollectionEnabled(
        crash.getCrashlytics(),
        this.config.crashlyticsEnabled,
      );
    } catch {
      // Firebase files are optional until this App supplies them.
    }
  }

  private async sendFirebaseEvent(name: string, properties: Properties) {
    try {
      const module = await import('@react-native-firebase/analytics');
      await module.logEvent(module.getAnalytics(), `mui_${name}`, { ...properties });
    } catch {
      // Backend telemetry remains canonical.
    }
  }

  private async sendCrashlytics(error: Error, context: Properties) {
    try {
      const module = await import('@react-native-firebase/crashlytics');
      const instance = module.getCrashlytics();
      for (const [key, value] of Object.entries(context)) {
        await module.setAttribute(instance, key, String(value));
      }
      module.recordError(instance, error);
    } catch {
      // Backend app_error has already been queued.
    }
  }
}

function disabledConfig(): TelemetryConfig {
  return {
    enabled: true,
    backendEnabled: true,
    firebaseMode: 'disabled',
    analyticsEnabled: false,
    crashlyticsEnabled: false,
  };
}

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function withJitter(delay: number) {
  return delay + Math.floor(Math.random() * Math.max(250, delay * 0.2));
}

export const telemetry = new Telemetry();
