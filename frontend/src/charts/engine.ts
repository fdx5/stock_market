import { init, use, graphic, getInstanceByDom } from "echarts/core";
import { LineChart, BarChart, CandlestickChart, GaugeChart } from "echarts/charts";
import { GridComponent, TooltipComponent, DataZoomComponent, MarkLineComponent, AriaComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
use([LineChart, BarChart, CandlestickChart, GaugeChart, GridComponent, TooltipComponent,
  DataZoomComponent, MarkLineComponent, AriaComponent, CanvasRenderer]);
export { init, graphic, getInstanceByDom };
