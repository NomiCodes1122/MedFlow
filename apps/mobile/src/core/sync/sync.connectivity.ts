export type ConnectivityListener = (isOnline: boolean) => void;

export interface INetworkStateProvider {
  fetchIsOnline(): Promise<boolean>;
  addEventListener(listener: ConnectivityListener): () => void;
}

/**
 * NetInfo network state provider for native React Native iOS and Android runtime.
 * Integrates with @react-native-community/netinfo.
 */
export class NetInfoNetworkProvider implements INetworkStateProvider {
  constructor(private netInfoModule: any) {}

  async fetchIsOnline(): Promise<boolean> {
    if (this.netInfoModule && typeof this.netInfoModule.fetch === 'function') {
      const state = await this.netInfoModule.fetch();
      return Boolean(state.isConnected && state.isInternetReachable !== false);
    }
    return true;
  }

  addEventListener(listener: ConnectivityListener): () => void {
    if (this.netInfoModule && typeof this.netInfoModule.addEventListener === 'function') {
      return this.netInfoModule.addEventListener((state: any) => {
        const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
        listener(isOnline);
      });
    }
    return () => {};
  }
}

/**
 * Default network provider with manual simulation capabilities.
 */
export class DefaultNetworkProvider implements INetworkStateProvider {
  private online = true;
  private listeners: Set<ConnectivityListener> = new Set();

  async fetchIsOnline(): Promise<boolean> {
    return this.online;
  }

  setOnline(online: boolean): void {
    if (this.online !== online) {
      this.online = online;
      for (const listener of this.listeners) {
        try {
          listener(online);
        } catch {
          // Prevent listener interruption
        }
      }
    }
  }

  addEventListener(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export class ConnectivityManager {
  private static defaultProvider = new DefaultNetworkProvider();
  private static activeProvider: INetworkStateProvider = ConnectivityManager.defaultProvider;
  private static online = true;
  private static listeners: Set<ConnectivityListener> = new Set();
  private static cleanupProviderSubscription?: () => void;

  static {
    this.bindProvider(this.defaultProvider);
  }

  private static bindProvider(provider: INetworkStateProvider): void {
    if (this.cleanupProviderSubscription) {
      this.cleanupProviderSubscription();
    }

    this.activeProvider = provider;
    this.cleanupProviderSubscription = provider.addEventListener((isOnline) => {
      if (this.online !== isOnline) {
        this.online = isOnline;
        this.notifyListeners(isOnline);
      }
    });

    provider.fetchIsOnline().then((isOnline) => {
      if (this.online !== isOnline) {
        this.online = isOnline;
        this.notifyListeners(isOnline);
      }
    }).catch(() => {});
  }

  static setProvider(provider: INetworkStateProvider): void {
    this.bindProvider(provider);
  }

  static isOnline(): boolean {
    return this.online;
  }

  static setOnline(online: boolean): void {
    this.defaultProvider.setOnline(online);
    if (this.online !== online) {
      this.online = online;
      this.notifyListeners(online);
    }
  }

  static addListener(listener: ConnectivityListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private static notifyListeners(isOnline: boolean): void {
    for (const listener of this.listeners) {
      try {
        listener(isOnline);
      } catch {
        // Prevent faulty listener from interrupting others
      }
    }
  }
}
