import * as path from 'path';

import { BinaryFile, RemoteFile } from '@waha/structures/files.dto';
import { fetchBuffer } from '@waha/utils/fetch';
import { Logger } from 'pino';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fs = require('fs-extra');

export async function fileExists(filepath: string) {
  try {
    await fs.access(filepath, fs.constants.F_OK);
  } catch (error) {
    return false;
  }
  return true;
}

export function safeJoin(base: string, input: string): string {
  base = path.resolve(base);

  if (!input || typeof input !== 'string') {
    throw new Error('Invalid path');
  }

  if (input.startsWith('~') || path.isAbsolute(input)) {
    throw new Error('Home or absolute paths not allowed');
  }

  // handles slashes safely
  const joined = path.join(base, input);
  // normalize to an absolute path
  const resolved = path.resolve(joined);

  // Prevent escape outside base dir
  if (!resolved.startsWith(base + path.sep)) {
    throw new Error('Access outside base dir not allowed');
  }

  return resolved;
}

/**
 * Extract base64 data from a string that might be:
 * 1. Data URI format: "data:mimetype;base64,XXXXX"
 * 2. Raw base64: "XXXXX"
 */
export function extractBase64Data(data: string, logger?: Logger): string {
  logger?.debug({ dataLength: data?.length }, 'Extracting base64 data');

  if (!data) {
    logger?.warn('Empty data provided to extractBase64Data');
    return data;
  }

  // Handle Data URI format: data:mimetype;base64,XXXXX
  const dataUriMatch = data.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUriMatch) {
    const mimetype = dataUriMatch[1];
    const base64Data = dataUriMatch[2];
    logger?.debug(
      {
        detectedMimetype: mimetype,
        originalLength: data.length,
        base64Length: base64Data.length,
      },
      'Detected Data URI format, extracted base64 data',
    );
    return base64Data;
  }

  logger?.debug(
    { dataLength: data.length },
    'Data is already raw base64 (no Data URI prefix)',
  );
  return data;
}

/**
 * Get buffer from file object (either remote URL or binary data)
 * Handles both RemoteFile (with url) and BinaryFile (with data)
 * Also handles Data URI format in BinaryFile.data
 */
export async function getFileBuffer(
  file: RemoteFile | BinaryFile,
  logger?: Logger,
): Promise<Buffer> {
  logger?.debug(
    {
      hasUrl: 'url' in file && !!file.url,
      hasData: 'data' in file && !!file.data,
      mimetype: file.mimetype,
      filename: file.filename,
    },
    'Getting file buffer',
  );

  // Handle RemoteFile (has url)
  if ('url' in file && file.url) {
    logger?.info({ url: file.url }, 'Downloading file from URL');
    try {
      const buffer = await fetchBuffer(file.url);
      logger?.debug(
        {
          url: file.url,
          bufferSize: buffer.length,
          bufferSizeKB: Math.round(buffer.length / 1024),
        },
        'Successfully downloaded file from URL',
      );
      return buffer;
    } catch (error) {
      logger?.error(
        { url: file.url, error: error.message },
        'Failed to download file from URL',
      );
      throw error;
    }
  }

  // Handle BinaryFile (has data)
  if ('data' in file && file.data) {
    logger?.debug(
      { dataLength: file.data.length },
      'Processing binary file data',
    );

    const base64Data = extractBase64Data(file.data, logger);

    try {
      const buffer = Buffer.from(base64Data, 'base64');
      logger?.debug(
        {
          base64Length: base64Data.length,
          bufferSize: buffer.length,
          bufferSizeKB: Math.round(buffer.length / 1024),
        },
        'Successfully decoded base64 to buffer',
      );
      return buffer;
    } catch (error) {
      logger?.error(
        { error: error.message, base64Length: base64Data.length },
        'Failed to decode base64 data',
      );
      throw error;
    }
  }

  const errorMsg = 'File must have either url or data field';
  logger?.error({ file: JSON.stringify(file) }, errorMsg);
  throw new Error(errorMsg);
}
