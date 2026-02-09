export interface SpanError {
  message: string;
  data: Record<string, any> | null;
}

export interface Span {
  object: 'trace.span';
  id: string;
  trace_id: string;
  parent_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  span_data: Record<string, any>;
  error: SpanError | null;
}

export interface Trace {
  object: 'trace';
  id: string;
  workflowName: string;
  groupId: string | null;
  metadata: Record<string, any> | null;
  spans?: Span[];
  createdAt?: string;
  updatedAt?: string;
  flow?: string[];
  handsoffsCount?: number;
  toolsCount?: number;
  executionTime?: number;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface TracesResponse {
  data: Trace[];
  pagination: Pagination;
  query?: {
    trace_id?: string;
    group_id?: string;
    workflow_name?: string;
    metadata?: Record<string, string>;
  };
}

export interface TraceResponse {
  data: Trace;
}
