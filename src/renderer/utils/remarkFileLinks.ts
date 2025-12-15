/**
 * remarkFileLinks - A remark plugin that transforms file path references into clickable links.
 *
 * Supports multiple patterns:
 * 1. Path-style references: `Folder/Subfolder/File` or `README.md`
 * 2. Wiki-style references (Obsidian): `[[Note Name]]` or `[[Folder/Note]]`
 * 3. Wiki-style with alias: `[[Folder/Note|Display Text]]` - links to Note but shows "Display Text"
 * 4. Absolute paths: `/Users/name/Project/file.md` (converted to relative if within projectRoot)
 *
 * Links are validated against the provided fileTree before conversion.
 * Uses `maestro-file://` protocol for internal file preview handling.
 */

import { visit } from 'unist-util-visit';
import type { Root, Text, Link } from 'mdast';
import type { FileNode } from '../hooks/useFileExplorer';

export interface RemarkFileLinksOptions {
  /** The file tree to validate paths against */
  fileTree: FileNode[];
  /** Current working directory for proximity-based matching (relative path) */
  cwd: string;
  /** Project root absolute path - used to convert absolute paths to relative */
  projectRoot?: string;
}

interface FilePathEntry {
  /** Relative path from project root */
  relativePath: string;
  /** Just the filename */
  filename: string;
}

/**
 * Build a flat index of all files in the tree for quick lookup
 */
function buildFileIndex(nodes: FileNode[], currentPath = ''): FilePathEntry[] {
  const entries: FilePathEntry[] = [];

  for (const node of nodes) {
    const nodePath = currentPath ? `${currentPath}/${node.name}` : node.name;

    if (node.type === 'file') {
      entries.push({
        relativePath: nodePath,
        filename: node.name,
      });
    } else if (node.type === 'folder' && node.children) {
      entries.push(...buildFileIndex(node.children, nodePath));
    }
  }

  return entries;
}

/**
 * Build a filename -> paths map for quick wiki-link lookup
 */
function buildFilenameIndex(entries: FilePathEntry[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const entry of entries) {
    // Index by filename (with and without .md extension)
    const paths = index.get(entry.filename) || [];
    paths.push(entry.relativePath);
    index.set(entry.filename, paths);

    // Also index without .md extension for convenience
    if (entry.filename.endsWith('.md')) {
      const withoutExt = entry.filename.slice(0, -3);
      const pathsNoExt = index.get(withoutExt) || [];
      pathsNoExt.push(entry.relativePath);
      index.set(withoutExt, pathsNoExt);
    }
  }

  return index;
}

/**
 * Calculate path proximity - how "close" a file path is to the cwd
 * Lower score = closer
 */
function calculateProximity(filePath: string, cwd: string): number {
  const fileSegments = filePath.split('/');
  const cwdSegments = cwd.split('/').filter(Boolean);

  // Find common prefix length
  let commonLength = 0;
  for (let i = 0; i < Math.min(fileSegments.length, cwdSegments.length); i++) {
    if (fileSegments[i] === cwdSegments[i]) {
      commonLength++;
    } else {
      break;
    }
  }

  // Score = steps up from cwd + steps down to file
  const stepsUp = cwdSegments.length - commonLength;
  const stepsDown = fileSegments.length - commonLength;

  return stepsUp + stepsDown;
}

/**
 * Find the closest matching path for a wiki-style reference
 */
function findClosestMatch(
  reference: string,
  filenameIndex: Map<string, string[]>,
  allPaths: Set<string>,
  cwd: string
): string | null {
  // First, try exact path match
  if (allPaths.has(reference)) {
    return reference;
  }

  // Try with .md extension
  if (allPaths.has(`${reference}.md`)) {
    return `${reference}.md`;
  }

  // Extract filename from reference (in case it includes a partial path)
  const refParts = reference.split('/');
  const filename = refParts[refParts.length - 1];

  // Look up by filename
  let candidates = filenameIndex.get(filename) || [];

  // Also try with .md appended
  if (candidates.length === 0 && !filename.endsWith('.md')) {
    candidates = filenameIndex.get(`${filename}.md`) || [];
  }

  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    return candidates[0];
  }

  // Multiple matches - filter by partial path if provided
  if (refParts.length > 1) {
    const partialPath = reference;
    const filtered = candidates.filter(c =>
      c.endsWith(partialPath) || c.endsWith(`${partialPath}.md`)
    );
    if (filtered.length === 1) {
      return filtered[0];
    }
    if (filtered.length > 1) {
      candidates = filtered;
    }
  }

  // Pick closest to cwd
  let closest = candidates[0];
  let closestScore = calculateProximity(candidates[0], cwd);

  for (let i = 1; i < candidates.length; i++) {
    const score = calculateProximity(candidates[i], cwd);
    if (score < closestScore) {
      closestScore = score;
      closest = candidates[i];
    }
  }

  return closest;
}

/**
 * Check if a path-style reference is valid
 */
function validatePathReference(
  reference: string,
  allPaths: Set<string>
): string | null {
  // Try exact match
  if (allPaths.has(reference)) {
    return reference;
  }

  // Try with .md extension
  if (allPaths.has(`${reference}.md`)) {
    return `${reference}.md`;
  }

  return null;
}

// Regex patterns
// Wiki-style: [[Note Name]] or [[Folder/Note]] or [[Folder/Note|Display Text]]
// The pipe syntax allows custom display text: [[path|display]]
const WIKI_LINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

// Path-style: Must contain a slash OR end with common file extensions
// Avoid matching URLs (no :// prefix)
const PATH_PATTERN = /(?<![:\w])(?:(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_.-]+|[A-Za-z0-9_-]+\.(?:md|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|hpp|css|scss|html|xml|sh|bash|zsh))(?![:\w/])/g;

// Absolute path pattern: Starts with / and contains path segments
// Matches paths like /Users/pedram/Project/file.md or /home/user/docs/note.txt
// Must end with a file extension to avoid matching arbitrary paths
const ABSOLUTE_PATH_PATTERN = /\/(?:[A-Za-z0-9_. -]+\/)+[A-Za-z0-9_. -]+\.(?:md|txt|json|yaml|yml|toml|ts|tsx|js|jsx|py|rb|go|rs|java|c|cpp|h|hpp|css|scss|html|xml|sh|bash|zsh)/g;

/**
 * The remark plugin
 */
export function remarkFileLinks(options: RemarkFileLinksOptions) {
  const { fileTree, cwd, projectRoot } = options;

  // Build indices
  const fileEntries = buildFileIndex(fileTree);
  const allPaths = new Set(fileEntries.map(e => e.relativePath));
  const filenameIndex = buildFilenameIndex(fileEntries);

  // Helper to convert absolute path to relative path
  const toRelativePath = (absPath: string): string | null => {
    if (!projectRoot) return null;
    // Normalize projectRoot to not have trailing slash
    const root = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot;
    if (absPath.startsWith(root + '/')) {
      return absPath.slice(root.length + 1);
    }
    return null;
  };

  return (tree: Root) => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined) return;

      const text = node.value;
      const replacements: (Text | Link)[] = [];
      let lastIndex = 0;

      // Combined processing - collect all matches with their positions
      interface Match {
        start: number;
        end: number;
        display: string;
        resolvedPath: string;
      }
      const matches: Match[] = [];

      // Find wiki-style links
      let wikiMatch;
      WIKI_LINK_PATTERN.lastIndex = 0;
      while ((wikiMatch = WIKI_LINK_PATTERN.exec(text)) !== null) {
        const reference = wikiMatch[1];  // The path part
        const displayText = wikiMatch[2];  // Optional display text after |
        const resolvedPath = findClosestMatch(reference, filenameIndex, allPaths, cwd);

        if (resolvedPath) {
          matches.push({
            start: wikiMatch.index,
            end: wikiMatch.index + wikiMatch[0].length,
            // Use display text if provided, otherwise use the reference
            display: displayText || reference,
            resolvedPath,
          });
        }
      }

      // Find absolute path references (e.g., /Users/pedram/Project/file.md)
      if (projectRoot) {
        let absMatch;
        ABSOLUTE_PATH_PATTERN.lastIndex = 0;
        while ((absMatch = ABSOLUTE_PATH_PATTERN.exec(text)) !== null) {
          const absolutePath = absMatch[0];

          // Skip if already inside another match
          const isInsideExisting = matches.some(m =>
            absMatch!.index >= m.start && absMatch!.index < m.end
          );
          if (isInsideExisting) continue;

          // Convert to relative path
          const relativePath = toRelativePath(absolutePath);
          if (relativePath && allPaths.has(relativePath)) {
            matches.push({
              start: absMatch.index,
              end: absMatch.index + absMatch[0].length,
              display: absolutePath,
              resolvedPath: relativePath,
            });
          }
        }
      }

      // Find path-style references (relative paths)
      let pathMatch;
      PATH_PATTERN.lastIndex = 0;
      while ((pathMatch = PATH_PATTERN.exec(text)) !== null) {
        const reference = pathMatch[0];

        // Skip if already inside another match
        const isInsideExisting = matches.some(m =>
          pathMatch!.index >= m.start && pathMatch!.index < m.end
        );
        if (isInsideExisting) continue;

        const resolvedPath = validatePathReference(reference, allPaths);

        if (resolvedPath) {
          matches.push({
            start: pathMatch.index,
            end: pathMatch.index + pathMatch[0].length,
            display: reference,
            resolvedPath,
          });
        }
      }

      // Sort matches by position
      matches.sort((a, b) => a.start - b.start);

      // No matches, nothing to do
      if (matches.length === 0) return;

      // Build replacement nodes
      for (const match of matches) {
        // Add text before this match
        if (match.start > lastIndex) {
          replacements.push({
            type: 'text',
            value: text.slice(lastIndex, match.start),
          });
        }

        // Add the link - use data-hProperties to pass the file path as a data attribute
        // This survives rehype processing which may strip custom protocols from href
        replacements.push({
          type: 'link',
          url: `maestro-file://${match.resolvedPath}`,
          data: {
            hProperties: {
              'data-maestro-file': match.resolvedPath,
            },
          },
          children: [{ type: 'text', value: match.display }],
        });

        lastIndex = match.end;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        replacements.push({
          type: 'text',
          value: text.slice(lastIndex),
        });
      }

      // Replace the node with our new nodes
      parent.children.splice(index, 1, ...replacements);

      // Return the index to continue from (skip the nodes we just inserted)
      return index + replacements.length;
    });
  };
}

export default remarkFileLinks;
