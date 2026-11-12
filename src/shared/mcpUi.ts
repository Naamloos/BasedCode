import type { CallToolResult, EmbeddedResource } from '@modelcontextprotocol/sdk/types.js';

/** Legacy MCP-UI embeds its views in tool results rather than linking a registered app resource. */
export function legacyMcpResources(result?: CallToolResult): EmbeddedResource['resource'][] {
  return result?.content.flatMap((item) => {
    if (item.type !== 'resource' || !item.resource.uri.startsWith('ui://')) return [];
    if (item.resource.mimeType?.includes('profile=mcp-app')) return [];
    const mime = item.resource.mimeType?.split(';')[0].trim();
    if (mime !== 'text/html' && mime !== 'text/uri-list' &&
        !mime?.startsWith('application/vnd.mcp-ui.remote-dom')) return [];
    return [{ ...item.resource, mimeType: mime === 'text/html' || mime === 'text/uri-list' ? mime : item.resource.mimeType }];
  }) ?? [];
}
