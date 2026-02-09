import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, DollarSign, Zap, FileText, Loader2, RefreshCw } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { analyticsApi, type AnalyticsOverview, type TimeSeriesData, type ModelBreakdown } from '../api';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DateTimePicker } from '@/components/ui/datetime-picker';


const chartConfig = {
  inputTokens: {
    label: 'Input Tokens',
    color: 'hsl(var(--chart-1))',
  },
  outputTokens: {
    label: 'Output Tokens',
    color: 'hsl(var(--chart-2))',
  },
  requests: {
    label: 'Requests',
    color: 'hsl(var(--chart-3))',
  },
  cost: {
    label: 'Cost ($)',
    color: 'hsl(var(--chart-4))',
  },
  traces: {
    label: 'Traces',
    color: 'hsl(var(--chart-5))',
  },
  openai: {
    label: 'OpenAI',
    color: 'hsl(var(--chart-1))',
  },
  claude: {
    label: 'Claude',
    color: 'hsl(var(--chart-2))',
  },
  gemini: {
    label: 'Gemini',
    color: 'hsl(var(--chart-3))',
  },
  qwen: {
    label: 'Qwen',
    color: 'hsl(var(--chart-4))',
  },
  deepseek: {
    label: 'Deepseek',
    color: 'hsl(var(--chart-5))',
  },
  other: {
    label: 'Other',
    color: 'hsl(25, 95%, 53%)',
  },
} satisfies ChartConfig;

type TimeRange = '1d' | '7d' | '30d' | 'this_month' | 'this_year' | 'custom';

export default function CostsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  
  const [timeRange, setTimeRange] = useState<TimeRange>(() => {
    const range = searchParams.get('range');
    if (range && ['1d', '7d', '30d', 'this_month', 'this_year', 'custom'].includes(range)) {
      return range as TimeRange;
    }
    return '30d';
  });
  
  const [customStartDate, setCustomStartDate] = useState<Date | undefined>(() => {
    const start = searchParams.get('start');
    return start ? new Date(start) : undefined;
  });
  
  const [customEndDate, setCustomEndDate] = useState<Date | undefined>(() => {
    const end = searchParams.get('end');
    return end ? new Date(end) : undefined;
  });
  
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [timeSeriesData, setTimeSeriesData] = useState<TimeSeriesData[]>([]);
  const [modelData, setModelData] = useState<{ data: ModelBreakdown[]; total: ModelBreakdown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [modelSort, setModelSort] = useState<{
    key: 'model' | 'requests' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cost';
    direction: 'asc' | 'desc';
  }>({ key: 'cost', direction: 'desc' });

  const { startDate, endDate } = useMemo(() => {
    if (timeRange === 'custom') {
      return {
        startDate: customStartDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: customEndDate || new Date(),
      };
    }

    const now = new Date();
    const end = new Date(now);
    const start = new Date(now);

    switch (timeRange) {
      case '1d':
        start.setDate(start.getDate() - 1);
        break;
      case '7d':
        start.setDate(start.getDate() - 7);
        break;
      case '30d':
        start.setDate(start.getDate() - 30);
        break;
      case 'this_month':
        start.setDate(1);
        break;
      case 'this_year':
        start.setMonth(0, 1);
        break;
    }

    return { startDate: start, endDate: end };
  }, [timeRange, customStartDate, customEndDate]);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set('range', timeRange);
    
    if (timeRange === 'custom') {
      if (customStartDate) {
        params.set('start', customStartDate.toISOString());
      }
      if (customEndDate) {
        params.set('end', customEndDate.toISOString());
      }
    } else {
      params.set('start', startDate.toISOString());
      params.set('end', endDate.toISOString());
    }
    
    setSearchParams(params, { replace: true });
  }, [timeRange, customStartDate, customEndDate, startDate, endDate, setSearchParams]);

  useEffect(() => {
    const fetchAnalytics = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const [overviewData, timeSeriesResponse, modelsResponse] = await Promise.all([
          analyticsApi.getOverview(startDate, endDate),
          analyticsApi.getTimeSeries(startDate, endDate),
          analyticsApi.getModels(startDate, endDate),
        ]);

        setOverview(overviewData);
        setTimeSeriesData(timeSeriesResponse.data);
        setModelData(modelsResponse);
      } catch (err) {
        console.error('Error fetching analytics:', err);
        setError('Failed to load analytics data');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [startDate, endDate]);

  const stats = useMemo(() => {
    if (!overview) {
      return {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        totalRequests: 0,
        totalTraces: 0,
        totalCost: 0,
        costChange: 0,
      };
    }

    return {
      totalInputTokens: overview.totalInputTokens,
      totalOutputTokens: overview.totalOutputTokens,
      totalTokens: overview.totalTokens,
      totalRequests: overview.totalRequests,
      totalTraces: overview.totalTraces,
      totalCost: overview.totalCost,
      costChange: overview.previousPeriod.costChange,
    };
  }, [overview]);

  const sortedModelRows = useMemo(() => {
    if (!modelData) {
      return [];
    }

    const rows = [...modelData.data];
    const { key, direction } = modelSort;
    const isAsc = direction === 'asc';

    rows.sort((a, b) => {
      const left = a[key];
      const right = b[key];

      if (typeof left === 'string' && typeof right === 'string') {
        const result = left.localeCompare(right);
        return isAsc ? result : -result;
      }

      if (typeof left === 'number' && typeof right === 'number') {
        const result = left - right;
        return isAsc ? result : -result;
      }

      return 0;
    });

    return rows;
  }, [modelData, modelSort]);

  const toggleModelSort = (
    key: 'model' | 'requests' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cost',
  ) => {
    setModelSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }

      return { key, direction: 'desc' };
    });
  };

  const renderModelSortLabel = (
    key: 'model' | 'requests' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'cost',
    label: string,
  ) => {
    const isActive = modelSort.key === key;
    const indicator = isActive ? (modelSort.direction === 'asc' ? '▲' : '▼') : '';

    return (
      <button
        type="button"
        onClick={() => toggleModelSort(key)}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <span>{label}</span>
        <span className="text-[10px] leading-none text-muted-foreground">{indicator}</span>
      </button>
    );
  };

  const getDateRangeLabel = () => {
    const labels: Record<string, string> = {
      '1d': 'Last 24 hours',
      '7d': 'Last 7 days',
      '30d': 'Last 30 days',
      'this_month': 'This month',
      'this_year': 'This year',
      'custom': 'Custom range',
    };
    return labels[timeRange] || 'Selected period';
  };

  const handleTimeRangeChange = (value: TimeRange) => {
    setTimeRange(value);
    if (value !== 'custom') {
      setCustomStartDate(undefined);
      setCustomEndDate(undefined);
    }
  };

  const handleDateChange = (date: Date | undefined, type: 'start' | 'end') => {
    if (type === 'start') {
      setCustomStartDate(date);
      setTimeRange('custom');
    } else {
      setCustomEndDate(date);
      setTimeRange('custom');
    }
  };

  const formatCost = (value: number) => {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const handleExport = () => {
    const csvContent = [
      ['Date', 'Input Tokens', 'Output Tokens', 'Total Tokens', 'Requests', 'Traces', 'Cost'],
      ...timeSeriesData.map((item) => [
        item.date,
        item.inputTokens.toString(),
        item.outputTokens.toString(),
        (item.inputTokens + item.outputTokens).toString(),
        item.requests.toString(),
        item.traces.toString(),
        item.cost.toFixed(2),
      ]),
    ]
      .map((row) => row.join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `costs-usage-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    // Reset to default 30d range to include current time
    setTimeRange('30d');
    setCustomStartDate(undefined);
    setCustomEndDate(undefined);
    setRefreshing(false);
  };

  if (loading) {
    return (
      <div className="flex-1 bg-background p-8">
        <div className="max-w-[1800px] mx-auto flex items-center justify-center h-[400px]">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>Loading analytics...</span>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 bg-background p-8">
        <div className="max-w-[1800px] mx-auto">
          <div className="bg-destructive/10 border border-destructive rounded-lg p-8 text-center">
            <p className="text-destructive">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-background p-8">
      <div className="max-w-[1800px] mx-auto">
        <div className="mb-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-2">Costs & Usage</h1>
              <p className="text-muted-foreground">
                {getDateRangeLabel()} • {timeSeriesData.length} days of data
              </p>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleRefresh} size="sm" variant="outline" disabled={refreshing}>
                <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <Button onClick={handleExport} size="sm" disabled={timeSeriesData.length === 0}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>

          <div className="flex gap-3 items-center">
            <div className="w-[160px]">
              <Select value={timeRange} onValueChange={(value) => handleTimeRangeChange(value as TimeRange)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1d">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="this_month">This month</SelectItem>
                  <SelectItem value="this_year">This year</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DateTimePicker
              value={startDate}
              onChange={(date) => handleDateChange(date, 'start')}
            />
            <span className="text-muted-foreground">to</span>
            <DateTimePicker
              value={endDate}
              onChange={(date) => handleDateChange(date, 'end')}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <div className="lg:col-span-2">
            <Card className="h-full">
              <CardHeader className="pb-3">
                <CardTitle>Cost Trend</CardTitle>
                <CardDescription>
                  Daily spending over time
                </CardDescription>
              </CardHeader>
              <CardContent className="pb-4 pl-0 mt-2">
                <ChartContainer config={chartConfig} className="aspect-auto h-[320px] w-full">
                  <AreaChart data={timeSeriesData}>
                    <defs>
                      <linearGradient id="fillCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--color-cost)" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="var(--color-cost)" stopOpacity={0.1} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      minTickGap={32}
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        });
                      }}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={(value) => `$${value.toLocaleString()}`}
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          labelFormatter={(value) => {
                            return new Date(value).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                              year: 'numeric',
                            });
                          }}
                          formatter={(value) => `$${formatCost(Number(value))}`}
                        />
                      }
                    />
                    <Area
                      dataKey="cost"
                      type="monotone"
                      fill="url(#fillCost)"
                      fillOpacity={0.4}
                      stroke="var(--color-cost)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Spending</CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  ${formatCost(stats.totalCost)}
                </div>
                <p className={`text-xs mt-1 ${stats.costChange >= 0 ? 'text-red-500' : 'text-green-500'}`}>
                  {stats.costChange >= 0 ? '+' : ''}{stats.costChange.toFixed(1)}% vs previous period
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Traces</CardTitle>
                <FileText className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.totalTraces.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.totalRequests.toLocaleString()} total requests
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Total Tokens</CardTitle>
                <Zap className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {(stats.totalTokens / 1000000).toFixed(2)}M
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {(stats.totalInputTokens / 1000000).toFixed(2)}M in / {(stats.totalOutputTokens / 1000000).toFixed(2)}M out
                </p>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Daily Requests</CardTitle>
              <CardDescription>
                API requests per day
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <BarChart data={timeSeriesData}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={32}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      });
                    }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => {
                          return new Date(value).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          });
                        }}
                      />
                    }
                  />
                  <Bar dataKey="requests" fill="var(--color-requests)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Token Usage</CardTitle>
              <CardDescription>
                Input vs Output tokens per day
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <ChartContainer config={chartConfig} className="h-[200px] w-full">
                <AreaChart data={timeSeriesData}>
                  <defs>
                    <linearGradient id="fillInputSmall" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-inputTokens)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-inputTokens)" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillOutputSmall" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-outputTokens)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-outputTokens)" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={32}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      });
                    }}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => {
                          return new Date(value).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          });
                        }}
                        indicator="dot"
                      />
                    }
                  />
                  <Area
                    dataKey="outputTokens"
                    type="monotone"
                    fill="url(#fillOutputSmall)"
                    stroke="var(--color-outputTokens)"
                    stackId="a"
                  />
                  <Area
                    dataKey="inputTokens"
                    type="monotone"
                    fill="url(#fillInputSmall)"
                    stroke="var(--color-inputTokens)"
                    stackId="a"
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Cost by Model</CardTitle>
              <CardDescription>
                Spending breakdown across different models
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
                <AreaChart data={timeSeriesData}>
                  <defs>
                    <linearGradient id="fillOpenAI" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-openai)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-openai)" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillClaude" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-claude)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-claude)" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillGemini" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-gemini)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-gemini)" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillQwen" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-qwen)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-qwen)" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillDeepseek" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-deepseek)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-deepseek)" stopOpacity={0.1} />
                    </linearGradient>
                    <linearGradient id="fillOther" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(25, 95%, 53%)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="hsl(25, 95%, 53%)" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={32}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      });
                    }}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => {
                          return new Date(value).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          });
                        }}
                        formatter={(value) => `$${Number(value).toFixed(2)}`}
                        indicator="line"
                      />
                    }
                  />
                  <Area
                    dataKey="openai"
                    type="monotone"
                    fill="url(#fillOpenAI)"
                    stroke="var(--color-openai)"
                    stackId="a"
                  />
                  <Area
                    dataKey="claude"
                    type="monotone"
                    fill="url(#fillClaude)"
                    stroke="var(--color-claude)"
                    stackId="a"
                  />
                  <Area
                    dataKey="gemini"
                    type="monotone"
                    fill="url(#fillGemini)"
                    stroke="var(--color-gemini)"
                    stackId="a"
                  />
                  <Area
                    dataKey="qwen"
                    type="monotone"
                    fill="url(#fillQwen)"
                    stroke="var(--color-qwen)"
                    stackId="a"
                  />
                  <Area
                    dataKey="deepseek"
                    type="monotone"
                    fill="url(#fillDeepseek)"
                    stroke="var(--color-deepseek)"
                    stackId="a"
                  />
                  <Area
                    dataKey="other"
                    type="monotone"
                    fill="url(#fillOther)"
                    stroke="hsl(25, 95%, 53%)"
                    stackId="a"
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle>Traces Over Time</CardTitle>
              <CardDescription>
                Number of traces per day
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
                <AreaChart data={timeSeriesData}>
                  <defs>
                    <linearGradient id="fillTraces" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-traces)" stopOpacity={0.8} />
                      <stop offset="95%" stopColor="var(--color-traces)" stopOpacity={0.1} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    minTickGap={32}
                    tickFormatter={(value) => {
                      const date = new Date(value);
                      return date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                      });
                    }}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => {
                          return new Date(value).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          });
                        }}
                      />
                    }
                  />
                  <Area
                    dataKey="traces"
                    type="monotone"
                    fill="url(#fillTraces)"
                    stroke="var(--color-traces)"
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Model Breakdown</CardTitle>
            <CardDescription>
              Detailed usage and cost breakdown by model
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!modelData || modelData.data.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No model data available for this period
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{renderModelSortLabel('model', 'Model')}</TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex justify-end w-full">{renderModelSortLabel('requests', 'Requests')}</span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex justify-end w-full">
                        {renderModelSortLabel('inputTokens', 'Input Tokens')}
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex justify-end w-full">
                        {renderModelSortLabel('outputTokens', 'Output Tokens')}
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex justify-end w-full">
                        {renderModelSortLabel('totalTokens', 'Total Tokens')}
                      </span>
                    </TableHead>
                    <TableHead className="text-right">
                      <span className="inline-flex justify-end w-full">{renderModelSortLabel('cost', 'Cost')}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedModelRows.map((model) => (
                    <TableRow key={model.model}>
                      <TableCell className="font-medium">{model.model}</TableCell>
                      <TableCell className="text-right">{model.requests.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{model.inputTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right">{model.outputTokens.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        {model.totalTokens.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ${formatCost(model.cost)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">
                      {modelData.total.requests.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {modelData.total.inputTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {modelData.total.outputTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {modelData.total.totalTokens.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      ${formatCost(modelData.total.cost)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
