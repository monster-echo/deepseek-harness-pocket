import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { apiClient, ApiClientError } from '../data/apiClient';
import {
  HelpArticle,
  SupportTicket,
  SupportTicketDetail,
} from '../domain/models';
import { AsyncState } from '../state/asyncState';
import { useApp } from '../state/AppStore';
import type { FeedbackScreenshot } from './FeedbackScreenshots';

type TicketInput = Readonly<{
  category: string;
  severity: 'normal' | 'high' | 'urgent';
  subject: string;
  message: string;
}>;

type FeedbackInput = Readonly<{
  category: 'suggestion' | 'experience' | 'feature_request' | 'other';
  title: string;
  body: string;
  rating?: number;
  screenshots: readonly FeedbackScreenshot[];
}>;

type SupportContextValue = Readonly<{
  help: AsyncState<readonly HelpArticle[]>;
  tickets: AsyncState<readonly SupportTicket[]>;
  detail: AsyncState<SupportTicketDetail>;
  busy: boolean;
  loadHome: () => Promise<void>;
  openTicket: (id: string) => Promise<void>;
  createTicket: (input: TicketInput) => Promise<boolean>;
  reply: (message: string) => Promise<boolean>;
  submitFeedback: (input: FeedbackInput) => Promise<boolean>;
}>;

const SupportContext = createContext<SupportContextValue | null>(null);

export function SupportProvider({ children }: Readonly<{ children: ReactNode }>) {
  const { navigate, showToast } = useApp();
  const [help, setHelp] = useState<AsyncState<readonly HelpArticle[]>>({ status: 'idle' });
  const [tickets, setTickets] = useState<AsyncState<readonly SupportTicket[]>>({ status: 'idle' });
  const [detail, setDetail] = useState<AsyncState<SupportTicketDetail>>({ status: 'idle' });
  const [busy, setBusy] = useState(false);

  const loadHome = useCallback(async () => {
    setHelp({ status: 'loading' });
    setTickets({ status: 'loading' });
    try {
      const [articles, items] = await Promise.all([
        apiClient.helpArticles(),
        apiClient.supportTickets(),
      ]);
      setHelp(articles.length ? { status: 'success', data: articles } : { status: 'empty' });
      setTickets(items.length ? { status: 'success', data: items } : { status: 'empty' });
    } catch (error) {
      setHelp(errorState<readonly HelpArticle[]>(error));
      setTickets(errorState<readonly SupportTicket[]>(error));
    }
  }, []);

  const openTicket = useCallback(async (id: string) => {
    setDetail({ status: 'loading' });
    navigate('support.ticket');
    try {
      setDetail({ status: 'success', data: await apiClient.supportTicket(id) });
    } catch (error) {
      setDetail(errorState(error));
    }
  }, [navigate]);

  const createTicket = useCallback(async (input: TicketInput) => {
    setBusy(true);
    try {
      const created = await apiClient.createSupportTicket(input);
      showToast('工单已提交', 'success');
      await openTicket(created.id);
      return true;
    } catch (error) {
      showToast(errorMessage(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [openTicket, showToast]);

  const reply = useCallback(async (message: string) => {
    if (detail.status !== 'success') return false;
    setBusy(true);
    try {
      const sent = await apiClient.replySupportTicket(detail.data.id, message);
      setDetail({
        status: 'success',
        data: {
          ...detail.data,
          status: 'waiting_for_support',
          updatedAt: sent.createdAt,
          messages: [...detail.data.messages, sent],
        },
      });
      return true;
    } catch (error) {
      showToast(errorMessage(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [detail, showToast]);

  const submitFeedback = useCallback(async (input: FeedbackInput) => {
    setBusy(true);
    try {
      await apiClient.submitFeedback(input);
      showToast('感谢反馈，我们会同步处理进度', 'success');
      return true;
    } catch (error) {
      showToast(errorMessage(error), 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }, [showToast]);

  const value = useMemo<SupportContextValue>(() => ({
    help,
    tickets,
    detail,
    busy,
    loadHome,
    openTicket,
    createTicket,
    reply,
    submitFeedback,
  }), [
    busy,
    createTicket,
    detail,
    help,
    loadHome,
    openTicket,
    reply,
    submitFeedback,
    tickets,
  ]);
  return <SupportContext.Provider value={value}>{children}</SupportContext.Provider>;
}

function errorState<T>(error: unknown): AsyncState<T> {
  const message = errorMessage(error);
  return error instanceof ApiClientError && error.status === 401
    ? { status: 'unauthorized' }
    : { status: 'error', message };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '服务暂时不可用';
}

export function useSupport() {
  const value = useContext(SupportContext);
  if (!value) throw new Error('useSupport must be used inside SupportProvider');
  return value;
}
