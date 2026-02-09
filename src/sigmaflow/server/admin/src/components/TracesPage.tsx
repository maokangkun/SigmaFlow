import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Tag, X, ChevronRight, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { tracesApi, type SearchFilters } from '../api';
import type { Trace, TracesResponse } from '../types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const parseMetadataFromUrl = (
  searchParams: URLSearchParams
): Array<{ key: string; value: string }> => {
  const metadata: Array<{ key: string; value: string }> = [];
  searchParams.forEach((value, key) => {
    if (key.startsWith('metadata.')) {
      const metadataKey = key.replace('metadata.', '');
      metadata.push({ key: metadataKey, value });
    }
  });
  return metadata;
};

const updateUrlParams = (
  workflowFilter: string,
  groupIdFilter: string,
  metadataFilters: Array<{ key: string; value: string }>,
  directIdSearch: string,
  startDate: Date | undefined,
  endDate: Date | undefined
) => {
  const params = new URLSearchParams();

  if (workflowFilter) params.set('workflow', workflowFilter);
  if (groupIdFilter) params.set('group', groupIdFilter);
  if (directIdSearch) params.set('id', directIdSearch);
  if (startDate) params.set('start_date', startDate.toISOString());
  if (endDate) params.set('end_date', endDate.toISOString());

  metadataFilters.forEach(({ key, value }) => {
    if (key && value) {
      params.set(`metadata.${key}`, value);
    }
  });

  const url = params.toString()
    ? `?${params.toString()}`
    : window.location.pathname;
  window.history.replaceState({}, '', url);
};

export default function TracesPage() {
  const navigate = useNavigate();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [workflowFilter, setWorkflowFilter] = useState('');
  const [groupIdFilter, setGroupIdFilter] = useState('');
  const [metadataFilters, setMetadataFilters] = useState<
    Array<{ key: string; value: string }>
  >([]);
  const [directIdSearch, setDirectIdSearch] = useState('');
  const [startDate, setStartDate] = useState<Date | undefined>(undefined);
  const [endDate, setEndDate] = useState<Date | undefined>(undefined);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const isLoadingMoreRef = useRef(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const loadTraces = async (page: number = 1, append: boolean = false) => {
    if (append) {
      if (isLoadingMoreRef.current) return;
      isLoadingMoreRef.current = true;
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const hasFilters =
        workflowFilter ||
        groupIdFilter ||
        metadataFilters.length > 0 ||
        startDate ||
        endDate;

      let response: TracesResponse;

      if (hasFilters) {
        const filters: SearchFilters = {};
        if (workflowFilter) filters.workflow_name = workflowFilter;
        if (groupIdFilter) filters.group_id = groupIdFilter;
        if (startDate) filters.start_date = startDate.toISOString();
        if (endDate) filters.end_date = endDate.toISOString();
        if (metadataFilters.length > 0) {
          filters.metadata = {};
          metadataFilters.forEach(({ key, value }) => {
            if (key && value && filters.metadata) {
              filters.metadata[key] = value;
            }
          });
        }
        response = await tracesApi.searchTraces(
          filters,
          page,
          pagination.limit
        );
      } else {
        response = await tracesApi.getTraces(page, pagination.limit);
      }

      if (append) {
        setTraces((prev) => [...prev, ...response.data]);
      } else {
        setTraces(response.data);
      }
      setPagination(response.pagination);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load traces');
    } finally {
      setLoading(false);
      setLoadingMore(false);
      isLoadingMoreRef.current = false;
    }
  };

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const workflow = searchParams.get('workflow') || '';
    const group = searchParams.get('group') || '';
    const id = searchParams.get('id') || '';
    const start = searchParams.get('start_date');
    const end = searchParams.get('end_date');
    const metadata = parseMetadataFromUrl(searchParams);

    setWorkflowFilter(workflow);
    setGroupIdFilter(group);
    setDirectIdSearch(id);
    setStartDate(start ? new Date(start) : undefined);
    setEndDate(end ? new Date(end) : undefined);
    setMetadataFilters(metadata);
    setIsInitialLoad(false);

    loadTraces(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isInitialLoad) return;

    const timeoutId = setTimeout(() => {
      setPagination((prev) => ({ ...prev, page: 1 }));
      updateUrlParams(
        workflowFilter,
        groupIdFilter,
        metadataFilters,
        directIdSearch,
        startDate,
        endDate
      );
      loadTraces(1);
    }, 500);

    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowFilter, groupIdFilter, startDate, endDate]);

  const handleSearch = () => {
    setPagination((prev) => ({ ...prev, page: 1 }));
    updateUrlParams(
      workflowFilter,
      groupIdFilter,
      metadataFilters,
      directIdSearch,
      startDate,
      endDate
    );
    loadTraces(1);
  };

  const handleClearFilters = () => {
    setWorkflowFilter('');
    setGroupIdFilter('');
    setMetadataFilters([]);
    setDirectIdSearch('');
    setStartDate(undefined);
    setEndDate(undefined);
    setPagination((prev) => ({ ...prev, page: 1 }));
    updateUrlParams('', '', [], '', undefined, undefined);
    setTimeout(() => loadTraces(1), 0);
  };

  const handleDelete = async (traceId: string, event: React.MouseEvent) => {
    event.stopPropagation(); // Prevent row click navigation
    
    if (deleteConfirm === traceId) {
      // Perform deletion
      setDeleting(traceId);
      try {
        await tracesApi.deleteTrace(traceId);
        // Remove from local state
        setTraces(prev => prev.filter(t => t.id !== traceId));
        setPagination(prev => ({
          ...prev,
          total: prev.total - 1,
        }));
        setDeleteConfirm(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete trace');
      } finally {
        setDeleting(null);
      }
    } else {
      // Show confirmation
      setDeleteConfirm(traceId);
      // Auto-cancel after 3 seconds
      setTimeout(() => {
        setDeleteConfirm(prev => prev === traceId ? null : prev);
      }, 3000);
    }
  };

  const handleDirectIdSearch = () => {
    if (!directIdSearch.trim()) return;
    navigate(`/trace/${directIdSearch.trim()}`);
  };

  const addMetadataFilter = () => {
    const updated = [...metadataFilters, { key: '', value: '' }];
    setMetadataFilters(updated);
  };

  const updateMetadataFilter = (
    index: number,
    field: 'key' | 'value',
    value: string
  ) => {
    const updated = [...metadataFilters];
    updated[index][field] = value;
    setMetadataFilters(updated);

    const timeoutId = setTimeout(() => {
      updateUrlParams(
        workflowFilter,
        groupIdFilter,
        updated,
        directIdSearch,
        startDate,
        endDate
      );
    }, 500);

    return () => clearTimeout(timeoutId);
  };

  const removeMetadataFilter = (index: number) => {
    const updated = metadataFilters.filter((_, i) => i !== index);
    setMetadataFilters(updated);
    setPagination((prev) => ({ ...prev, page: 1 }));
    updateUrlParams(
      workflowFilter,
      groupIdFilter,
      updated,
      directIdSearch,
      startDate,
      endDate
    );
    setTimeout(() => loadTraces(1), 0);
  };

  const getExecutionTime = (trace: Trace): string => {
    const duration = (trace as any).executionTime;
    if (duration === undefined || duration === null || duration === 0) {
      return 'N/A';
    }
    const seconds = Number(duration);
    if (!Number.isFinite(seconds)) {
      return 'N/A';
    }
    return `${seconds.toFixed(2)}s`;
  };

  const formatDate = (dateStr: string | undefined): string => {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
  };

  return (
    <div className="flex-1 bg-background flex flex-col h-screen overflow-hidden">
      <div className="sticky top-0 z-40 bg-background border-b border-border">
        <div className="px-8 py-6 bg-gradient-to-r from-card to-card/50 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground mb-1 tracking-tight">
                Traces
              </h1>
              <p className="text-sm text-muted-foreground">
                View and search through your agent workflow traces
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => loadTraces(1)}
                disabled={loading}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
              <div className="px-3 py-1.5 rounded-full bg-primary/10 text-primary font-medium text-sm">
                {pagination.total} total
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-muted/30 border-t border-border">
          <div className="flex flex-row items-center gap-3 flex-wrap">
            <div className="relative" style={{ width: '200px' }}>
              <div className="flex items-center bg-background border border-input rounded-full px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring transition-colors">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Workflow"
                  value={workflowFilter}
                  onChange={(e) => setWorkflowFilter(e.target.value)}
                  className="border-0 bg-transparent h-auto px-2 py-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
                />
              </div>
            </div>

            <div className="relative" style={{ width: '200px' }}>
              <div className="flex items-center bg-background border border-input rounded-full px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring transition-colors">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Group"
                  value={groupIdFilter}
                  onChange={(e) => setGroupIdFilter(e.target.value)}
                  className="border-0 bg-transparent h-auto px-2 py-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
                />
              </div>
            </div>

            <DateTimePicker
              value={startDate}
              onChange={setStartDate}
              placeholder="Start Date & Time"
              className="w-56"
            />

            <DateTimePicker
              value={endDate}
              onChange={setEndDate}
              placeholder="End Date & Time"
              className="w-56"
            />

            <Button
              variant={metadataFilters.length > 0 ? 'default' : 'outline'}
              size="sm"
              onClick={() =>
                metadataFilters.length === 0 && addMetadataFilter()
              }
              className="rounded-full"
            >
              <Tag className="w-4 h-4" />
              Metadata
              {metadataFilters.length > 0 && (
                <span className="bg-background text-foreground px-1.5 py-0.5 rounded-full text-xs font-medium ml-1">
                  {metadataFilters.length}
                </span>
              )}
            </Button>

            {(workflowFilter ||
              groupIdFilter ||
              metadataFilters.length > 0 ||
              directIdSearch ||
              startDate ||
              endDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearFilters}
                disabled={loading}
              >
                Clear filters
              </Button>
            )}

            <div className="flex-1"></div>

            <div className="relative" style={{ width: '240px' }}>
              <div className="flex items-center bg-background border border-input rounded-full px-3 py-1.5 focus-within:ring-2 focus-within:ring-ring transition-colors">
                <Search className="w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search by ID..."
                  value={directIdSearch}
                  onChange={(e) => setDirectIdSearch(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleDirectIdSearch()}
                  className="border-0 bg-transparent h-auto px-2 py-0 text-sm focus-visible:ring-0 focus-visible:ring-offset-0 shadow-none"
                />
              </div>
            </div>
          </div>

          {metadataFilters.length > 0 && (
            <div className="mt-4 p-4 bg-card border border-border rounded-lg">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-foreground">
                  Metadata Filters
                </h4>
              </div>
              <div className="space-y-2">
                {metadataFilters.map((filter, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={filter.key}
                      onChange={(e) =>
                        updateMetadataFilter(index, 'key', e.target.value)
                      }
                      placeholder="Key"
                      className="flex-1"
                    />
                    <Input
                      value={filter.value}
                      onChange={(e) =>
                        updateMetadataFilter(index, 'value', e.target.value)
                      }
                      placeholder="Value"
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeMetadataFilter(index)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-3">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={addMetadataFilter}
                >
                  + Add Filter
                </Button>
                <Button size="sm" onClick={handleSearch} disabled={loading}>
                  {loading ? 'Applying...' : 'Apply Filters'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="bg-destructive/10 border-t border-destructive text-destructive-foreground px-6 py-3">
            {error}
          </div>
        )}
      </div>

      <div
        className="flex-1 overflow-auto bg-card/50 pretty-scrollbar"
        onScroll={(e) => {
          const target = e.currentTarget;
          const scrollTop = target.scrollTop;
          const scrollHeight = target.scrollHeight;
          const clientHeight = target.clientHeight;

          // Load more when scrolled within 100px of the bottom
          const scrolledToBottom =
            scrollHeight - scrollTop - clientHeight < 100;

          if (
            scrolledToBottom &&
            !isLoadingMoreRef.current &&
            pagination.hasNext
          ) {
            console.log('Loading more traces...', {
              page: pagination.page + 1,
              hasNext: pagination.hasNext,
            });
            loadTraces(pagination.page + 1, true);
          }
        }}
      >
        <Table>
          <TableHeader className="sticky top-0 z-30 bg-card backdrop-blur-sm after:content-[''] after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[1px] after:bg-border">
            <TableRow className="hover:bg-transparent">
              <TableHead className="font-semibold" style={{ width: '300px' }}>
                Workflow
              </TableHead>
              <TableHead className="font-semibold">Flow</TableHead>
              <TableHead
                className="text-center font-semibold"
                style={{ width: '90px' }}
              >
                Handoffs
              </TableHead>
              <TableHead
                className="text-center font-semibold"
                style={{ width: '90px' }}
              >
                Tools
              </TableHead>
              <TableHead
                className="text-right font-semibold"
                style={{ width: '150px' }}
              >
                Execution time
              </TableHead>
              <TableHead
                className="text-right font-semibold"
                style={{ width: '180px' }}
              >
                Created
              </TableHead>
              <TableHead
                className="text-center font-semibold"
                style={{ width: '80px' }}
              >
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading traces...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : traces.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-8"
                >
                  No traces found
                </TableCell>
              </TableRow>
            ) : (
              traces.map((trace) => {
                const flow = trace.flow ?? [];
                const flowItems = flow.slice(0, 2);
                const hasMore = flow.length > 2;

                return (
                  <TableRow
                    key={trace.id}
                    onClick={() => navigate(`/trace/${trace.id}`)}
                    className="cursor-pointer hover:bg-accent/50 transition-colors group h-[45px]"
                  >
                    <TableCell className="font-semibold text-foreground group-hover:text-primary transition-colors py-2 px-6">
                      {(trace as any).workflowName}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[260px] py-2 px-6">
                      <div className="flex items-center gap-1.5 overflow-hidden">
                        {flowItems.length > 0 ? (
                          <>
                            {flowItems.map((agent, index) => (
                              <div
                                key={`${agent}-${index}`}
                                className="flex items-center gap-1.5"
                              >
                                <span className="font-mono text-xs whitespace-nowrap">
                                  {agent}
                                </span>
                                {index < flowItems.length - 1 && (
                                  <ChevronRight className="w-3 h-3 text-muted-foreground/100 flex-shrink-0" />
                                )}
                              </div>
                            ))}
                            {hasMore && (
                              <span className="font-mono text-xs whitespace-nowrap">
                                ...
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="font-mono text-xs">N/A</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-center py-2 px-6">
                      <span className="text-foreground text-xs font-medium">
                        {(trace as any).handsoffsCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-center py-2 px-6">
                      <span className="text-foreground text-xs font-medium">
                        {(trace as any).toolsCount ?? 0}
                      </span>
                    </TableCell>
                    <TableCell className="text-right py-2 px-6">
                      <span className="text-muted-foreground font-mono text-xs">
                        {getExecutionTime(trace)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-xs py-2 px-6">
                      {formatDate((trace as any).createdAt)}
                    </TableCell>
                    <TableCell className="text-center py-2 px-4">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => handleDelete(trace.id, e)}
                        disabled={deleting === trace.id}
                      >
                        {deleting === trace.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : deleteConfirm === trace.id ? (
                          <span className="text-xs font-semibold">Sure?</span>
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
            {loadingMore && (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="text-center text-muted-foreground py-4"
                >
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Loading more traces...</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
