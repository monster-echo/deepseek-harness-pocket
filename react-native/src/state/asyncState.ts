export type AsyncState<T> =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'success'; data: T }>
  | Readonly<{ status: 'empty' }>
  | Readonly<{ status: 'error'; message: string }>
  | Readonly<{ status: 'offline' }>
  | Readonly<{ status: 'unauthorized' }>;
