import type { LokiQueryRangeResponse, LokiStream } from '../loki';

/**
 * Shaped like real staging responses: Envoy's OTEL sink puts every field on
 * the stream and leaves the line empty, so each request is its own stream.
 */
export function accessLogStream(
  ns: string,
  overrides: Record<string, string> = {}
): LokiStream {
  return {
    stream: {
      authority: 'origin.internal',
      bytes_sent: '22382',
      cluster_name: 'datum-downstream-gateway',
      duration: '16',
      k8s_pod_name: 'envoy-datum-downstream-gateway-abc',
      log_name: 'otel_envoy_accesslog',
      method: 'GET',
      milo_project_id: 'proj-a',
      path: '/static/favicon.ico',
      protocol: 'HTTP/1.1',
      referer: '-',
      request_id: `req-${ns}`,
      requested_server_name: 'app.example.com',
      response_code: '200',
      response_flags: '-',
      route_name: 'httproute/ns-1/gw-1/rule/1/match/0/app_example_com',
      upstream_host: '52.21.224.34:443',
      user_agent: 'Mozilla/5.0',
      x_forwarded_host: 'app.example.com',
      ...overrides,
    },
    values: [[ns, '']],
  };
}

export function streams(...result: LokiStream[]): LokiQueryRangeResponse {
  return { status: 'success', data: { resultType: 'streams', result } };
}

/** Unikraft console output: one stream per instance, ANSI colour codes intact. */
export function consoleStream(instance: string, values: [string, string][]): LokiStream {
  return {
    stream: {
      container_id: '9af1e50e',
      datum_instance_name: instance,
      datum_workload_name: 'web',
      k8s_pod_name: instance,
      log_file_name: 'vm.log',
      milo_project_id: 'proj-a',
    },
    values,
  };
}
