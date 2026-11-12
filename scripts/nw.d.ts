declare module 'nw' {
  export function get(options: {
    version: string;
    platform: string;
    arch: string;
    flavor: string;
    downloadUrl: string;
    manifestUrl: string;
    cacheDir: string;
    cache: boolean;
    ffmpeg: boolean;
    nativeAddon: boolean;
    shaSum: boolean;
  }): Promise<unknown>;
}
