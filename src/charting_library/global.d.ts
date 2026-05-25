import type { ChartingLibraryWidgetOptions, IChartingLibraryWidget } from './charting_library';

declare global {
  interface Window {
    TradingView?: {
      widget: new (options: ChartingLibraryWidgetOptions) => IChartingLibraryWidget;
      version?: () => string;
    };
  }
}

export {};
