// Platform is injected at runtime: the RN App entry calls setPlatformHeader(Platform.OS),
// tests call setPlatformHeader('ios') (the server only maps ios/android/harmonyos → store key).
let platform = 'web';
export function setPlatformHeader(value: string) { platform = value; }
export function getPlatformHeader() { return platform; }
