import { useEffect, useRef } from 'react';
import * as echarts from 'echarts/core';
import { HeatmapChart, RadarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, RadarComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { Card } from 'antd';

echarts.use([HeatmapChart, RadarChart, GridComponent, LegendComponent, RadarComponent, TooltipComponent, VisualMapComponent, CanvasRenderer]);

export default function AdvancedChartPanel({ title, option, height = 300 }: {
  title: string;
  option: EChartsOption;
  height?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.EChartsType | null>(null);
  useEffect(() => {
    if (!host.current) return;
    chart.current = echarts.init(host.current, undefined, { renderer: 'canvas' });
    const resize = () => chart.current?.resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    chart.current.setOption(option, true);
    return () => { observer.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, [option]);
  return <Card title={title} className="chart-card"><div ref={host} style={{ height }} role="img" aria-label={title} /></Card>;
}
