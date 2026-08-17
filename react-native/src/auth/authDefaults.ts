import { AuthProviderPolicy, AuthProviders } from '../domain/models';

export const defaultProviders: AuthProviders = {
  password: true,
  phone: true,
  apple: false,
  google: false,
  github: false,
  wechat: false,
};

export const defaultProviderPolicy: AuthProviderPolicy = {
  ...defaultProviders,
};
