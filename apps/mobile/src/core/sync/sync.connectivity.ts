type ConnectivityListener = (isOnline: boolean) => void;

export class ConnectivityManager {
  private static online = true;
  private static listeners: Set<ConnectivityListener> = new Set();

  static isOnline(): boolean {
    return this.online;
  }

  static setOnline(online: boolean): void {
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
      } catch (err) {
        // Prevent one faulty listener from interrupting others
      }
    }
  }
}
