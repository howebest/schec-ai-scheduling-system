import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, PieChart, ScatterChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { Card } from 'antd';

echarts.use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, LegendComponent, TooltipComponent, TitleComponent, CanvasRenderer]);

export default function ChartPanel({ title, option, height = 300, extra, onChartClick }: {
  title: string;
  option: EChartsOption;
  height?: number;
  extra?: ReactNode;
  onChartClick?: (event: any) => void;
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
    if (onChartClick) chart.current.on('click', onChartClick);
    return () => { observer.disconnect(); if (onChartClick) chart.current?.off('click', onChartClick); chart.current?.dispose(); chart.current = null; };
  }, [option, onChartClick]);
  return <Card title={title} extra={extra} className="chart-card"><div ref={host} style={{ height }} role="img" aria-label={title} /></Card>;
}
