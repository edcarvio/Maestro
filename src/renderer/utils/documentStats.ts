/**
 * documentStats - Utility for computing document metadata from markdown files.
 *
 * Used by the Document Graph feature to display document statistics in graph nodes.
 * Computes:
 * - Line count
 * - Word count
 * - File size (formatted)
 * - Title (from front matter, first heading, or filename)
 * - Description (from front matter)
 */

import * as path from 'path';
import { parseMarkdownLinks } from './markdownLinkParser';

/**
 * Document statistics extracted from a markdown file
 */
export interface DocumentStats {
  /** Document title (from front matter, first heading, or filename) */
  title: string;
  /** Number of lines in the document */
  lineCount: number;
  /** Number of words in the document */
  wordCount: number;
  /** Human-readable file size (e.g., "1.2 KB", "3.4 MB") */
  size: string;
  /** Optional description from front matter */
  description?: string;
  /** Path to the document file */
  filePath: string;
  /** Paths to broken internal links (links to non-existent files) */
  brokenLinks?: string[];
  /** True if the file is very large (>1MB) and was truncated for parsing */
  isLargeFile?: boolean;
}

/**
 * Front matter keys to check for description, in order of preference.
 * The first matching key will be used.
 */
const DESCRIPTION_KEYS = [
  'description',
  'overview',
  'abstract',
  'summary',
  'synopsis',
  'intro',
  'introduction',
  'about',
  'tldr',
  'excerpt',
  'blurb',
  'brief',
  'preamble',
] as const;

/**
 * Format a file size in bytes to a human-readable string
 * @param bytes - File size in bytes
 * @returns Formatted string (e.g., "1.2 KB", "3.4 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let size = bytes;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  // Use integer for bytes, 1 decimal for KB and above
  if (unitIndex === 0) {
    return `${Math.round(size)} ${units[unitIndex]}`;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Count words in content, splitting on whitespace and filtering empty strings
 * @param content - Text content to count words in
 * @returns Number of words
 */
export function countWords(content: string): number {
  if (!content || content.trim() === '') {
    return 0;
  }

  // Split on any whitespace (spaces, tabs, newlines, etc.)
  const words = content.split(/\s+/).filter((word) => word.length > 0);
  return words.length;
}

/**
 * Count lines in content
 * @param content - Text content to count lines in
 * @returns Number of lines
 */
export function countLines(content: string): number {
  if (!content) {
    return 0;
  }

  // Empty string has 0 lines, any content has at least 1 line
  if (content.trim() === '') {
    return 0;
  }

  // Count line breaks and add 1 (content without trailing newline)
  // Content with trailing newline: "a\nb\n" has 2 lines
  // Content without trailing newline: "a\nb" has 2 lines
  const lines = content.split('\n');

  // If the last element is empty (trailing newline), don't count it
  if (lines[lines.length - 1] === '') {
    return lines.length - 1;
  }

  return lines.length;
}

/**
 * Extract title from content, checking in order:
 * 1. Front matter 'title' field
 * 2. First H1 heading (# Title)
 * 3. Filename without extension
 *
 * @param content - Markdown content
 * @param filePath - Path to the file
 * @param frontMatter - Parsed front matter object
 * @returns Title string
 */
export function extractTitle(
  content: string,
  filePath: string,
  frontMatter: Record<string, unknown>
): string {
  // 1. Check front matter for title
  if (frontMatter.title && typeof frontMatter.title === 'string') {
    return frontMatter.title;
  }

  // 2. Look for first H1 heading
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    return headingMatch[1].trim();
  }

  // 3. Fall back to filename without extension
  const basename = path.basename(filePath, path.extname(filePath));
  return basename;
}

/**
 * Extract description from front matter, checking multiple possible keys
 *
 * @param frontMatter - Parsed front matter object
 * @returns Description string if found, undefined otherwise
 */
export function extractDescription(
  frontMatter: Record<string, unknown>
): string | undefined {
  for (const key of DESCRIPTION_KEYS) {
    const value = frontMatter[key];
    if (value && typeof value === 'string') {
      return value;
    }
  }

  return undefined;
}

/**
 * Compute document statistics from markdown content.
 * Handles malformed content gracefully - never throws, always returns valid stats.
 *
 * @param content - The markdown file content
 * @param filePath - The relative path of the file
 * @param fileSize - File size in bytes
 * @returns DocumentStats object with computed metadata
 */
export function computeDocumentStats(
  content: string,
  filePath: string,
  fileSize: number
): DocumentStats {
  // Handle null/undefined content
  const safeContent = content ?? '';
  const safeFilePath = filePath ?? 'unknown.md';
  const safeFileSize = typeof fileSize === 'number' && !isNaN(fileSize) ? fileSize : 0;

  // Parse front matter using existing utility (already handles errors gracefully)
  let frontMatter: Record<string, unknown> = {};
  try {
    const parsed = parseMarkdownLinks(safeContent, safeFilePath);
    frontMatter = parsed.frontMatter;
  } catch (error) {
    // parseMarkdownLinks should never throw, but defensive coding
    console.warn(`Unexpected error parsing front matter in ${safeFilePath}:`, error);
    frontMatter = {};
  }

  // Compute stats with error handling for each operation
  let title: string;
  try {
    title = extractTitle(safeContent, safeFilePath, frontMatter);
  } catch (error) {
    console.warn(`Failed to extract title from ${safeFilePath}:`, error);
    title = path.basename(safeFilePath, path.extname(safeFilePath));
  }

  let lineCount: number;
  try {
    lineCount = countLines(safeContent);
  } catch (error) {
    console.warn(`Failed to count lines in ${safeFilePath}:`, error);
    lineCount = 0;
  }

  let wordCount: number;
  try {
    wordCount = countWords(safeContent);
  } catch (error) {
    console.warn(`Failed to count words in ${safeFilePath}:`, error);
    wordCount = 0;
  }

  const size = formatFileSize(safeFileSize);
  const description = extractDescription(frontMatter);

  return {
    title,
    lineCount,
    wordCount,
    size,
    description,
    filePath: safeFilePath,
  };
}

export default computeDocumentStats;
