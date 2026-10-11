/// <reference types="vite/client" />

declare module 'mammoth' {
  const mammoth: {
    convertToHtml: (input: { arrayBuffer: ArrayBuffer } | { buffer: Buffer }) => Promise<{ value: string; messages: any[] }>;
    extractRawText: (input: { arrayBuffer: ArrayBuffer } | { buffer: Buffer }) => Promise<{ value: string; messages: any[] }>;
  };
  export default mammoth;
}
