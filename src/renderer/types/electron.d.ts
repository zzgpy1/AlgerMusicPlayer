export interface IElectronAPI {
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  dragStart: (_data: string) => void;
  miniTray: () => void;
  restart: () => void;
  openLyric: () => void;
  sendLyric: (_data: string) => void;
  unblockMusic: (_id: number) => Promise<string>;
  importCustomApiPlugin: () => Promise<{ name: string; content: string } | null>;
  importLxMusicScript: () => Promise<{ name: string; content: string } | null>;
  onLanguageChanged: (_callback: (_locale: string) => void) => void;
  store: {
    get: (_key: string) => Promise<any>;
    set: (_key: string, _value: any) => Promise<boolean>;
    delete: (_key: string) => Promise<boolean>;
  };
}

declare global {
  interface Window {
    api: IElectronAPI;
  }
}
