declare module 'stats.js' {
  export default class Stats {
    dom: HTMLDivElement;
    showPanel(panel: number): void;
    begin(): void;
    end(): void;
  }
}

declare module 'react-scan' {
  interface ScanOptions {
    enabled?: boolean;
    log?: boolean;
  }
  export function scan(options?: ScanOptions): void;
}
