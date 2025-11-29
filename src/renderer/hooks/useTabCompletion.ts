import { useMemo } from 'react';
import type { Session } from '../types';
import type { FileNode } from './useFileExplorer';

export interface TabCompletionSuggestion {
  value: string;
  type: 'history' | 'file' | 'folder';
  displayText: string;
}

export interface UseTabCompletionReturn {
  getSuggestions: (input: string) => TabCompletionSuggestion[];
}

/**
 * Hook for providing tab completion suggestions from:
 * 1. Shell command history
 * 2. Current directory file tree
 */
export function useTabCompletion(session: Session | null): UseTabCompletionReturn {
  // Build a flat list of file/folder names from the file tree
  const fileNames = useMemo(() => {
    if (!session?.fileTree) return [];

    const names: { name: string; type: 'file' | 'folder'; path: string }[] = [];

    const traverse = (nodes: FileNode[], currentPath = '') => {
      for (const node of nodes) {
        const fullPath = currentPath ? `${currentPath}/${node.name}` : node.name;
        names.push({
          name: node.name,
          type: node.type,
          path: fullPath
        });
        if (node.type === 'folder' && node.children) {
          traverse(node.children, fullPath);
        }
      }
    };

    traverse(session.fileTree);
    return names;
  }, [session?.fileTree]);

  const getSuggestions = (input: string): TabCompletionSuggestion[] => {
    if (!session || !input.trim()) return [];

    const suggestions: TabCompletionSuggestion[] = [];
    const inputLower = input.toLowerCase();
    const seenValues = new Set<string>();

    // Get the last "word" for file/folder completion
    // This handles cases like "cd src/", "cat file", etc.
    const parts = input.split(/\s+/);
    const lastPart = parts[parts.length - 1] || '';
    const prefix = parts.slice(0, -1).join(' ');
    const lastPartLower = lastPart.toLowerCase();

    // 1. Check shell command history for matches
    const history = session.shellCommandHistory || [];
    for (const cmd of history) {
      if (cmd.toLowerCase().startsWith(inputLower) && !seenValues.has(cmd)) {
        seenValues.add(cmd);
        suggestions.push({
          value: cmd,
          type: 'history',
          displayText: cmd
        });
      }
    }

    // 2. Check file tree for matches on the last word
    // Handle path-like completions (e.g., "cd src/comp" should match files in src/)
    const pathParts = lastPart.split('/');
    const searchInPath = pathParts.length > 1 ? pathParts.slice(0, -1).join('/') : '';
    const searchTerm = pathParts[pathParts.length - 1].toLowerCase();

    for (const file of fileNames) {
      // If user is typing a path, only show files in that path
      if (searchInPath) {
        if (!file.path.toLowerCase().startsWith(searchInPath.toLowerCase() + '/')) {
          continue;
        }
        // Check if the remaining part matches
        const remaining = file.path.slice(searchInPath.length + 1);
        const remainingParts = remaining.split('/');
        // Only show immediate children
        if (remainingParts.length !== 1) continue;
        if (!remaining.toLowerCase().startsWith(searchTerm)) continue;
      } else {
        // Top-level search
        if (!file.name.toLowerCase().startsWith(searchTerm)) continue;
        // For top-level, only show top-level items (no / in path)
        if (file.path.includes('/')) continue;
      }

      const completedPath = searchInPath ? `${searchInPath}/${file.name}` : file.name;
      const fullValue = prefix ? `${prefix} ${completedPath}` : completedPath;

      if (!seenValues.has(fullValue)) {
        seenValues.add(fullValue);
        suggestions.push({
          value: fullValue + (file.type === 'folder' ? '/' : ''),
          type: file.type,
          displayText: completedPath + (file.type === 'folder' ? '/' : '')
        });
      }
    }

    // Sort: history first, then folders, then files
    // Within each category, sort alphabetically
    suggestions.sort((a, b) => {
      const typeOrder = { history: 0, folder: 1, file: 2 };
      if (typeOrder[a.type] !== typeOrder[b.type]) {
        return typeOrder[a.type] - typeOrder[b.type];
      }
      return a.displayText.localeCompare(b.displayText);
    });

    // Limit to reasonable number
    return suggestions.slice(0, 10);
  };

  return { getSuggestions };
}
