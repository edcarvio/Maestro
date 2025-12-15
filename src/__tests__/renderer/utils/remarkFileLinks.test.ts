import { describe, it, expect } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { remarkFileLinks } from '../../../renderer/utils/remarkFileLinks';
import type { FileNode } from '../../../renderer/hooks/useFileExplorer';

// Helper to process markdown and return the result
async function processMarkdown(content: string, fileTree: FileNode[], cwd: string, projectRoot?: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkFileLinks, { fileTree, cwd, projectRoot })
    .use(remarkStringify)
    .process(content);
  return String(result);
}

// Sample file tree for testing
const sampleFileTree: FileNode[] = [
  {
    name: 'OPSWAT',
    type: 'folder',
    children: [
      {
        name: 'Meetings',
        type: 'folder',
        children: [
          { name: 'OP-0088.md', type: 'file' },
          { name: 'OP-0200.md', type: 'file' },
        ]
      },
      { name: 'README.md', type: 'file' }
    ]
  },
  {
    name: 'Notes',
    type: 'folder',
    children: [
      { name: 'Meeting Notes.md', type: 'file' },
      { name: 'TODO.md', type: 'file' },
    ]
  },
  {
    name: 'Archive',
    type: 'folder',
    children: [
      { name: 'Meeting Notes.md', type: 'file' }, // Duplicate filename
    ]
  },
  { name: 'README.md', type: 'file' },
  { name: 'config.json', type: 'file' },
  { name: 'index.ts', type: 'file' },
];

describe('remarkFileLinks', () => {
  describe('path-style references', () => {
    it('converts valid path with slash to link', async () => {
      const result = await processMarkdown(
        'See OPSWAT/Meetings/OP-0088 for details.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[OPSWAT/Meetings/OP-0088](maestro-file://OPSWAT/Meetings/OP-0088.md)');
    });

    it('converts path with .md extension', async () => {
      const result = await processMarkdown(
        'Check OPSWAT/README.md for info.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[OPSWAT/README.md](maestro-file://OPSWAT/README.md)');
    });

    it('converts single file reference with extension', async () => {
      const result = await processMarkdown(
        'See README.md for details.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[README.md](maestro-file://README.md)');
    });

    it('converts file references with various extensions', async () => {
      const result = await processMarkdown(
        'Check config.json and index.ts',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[config.json](maestro-file://config.json)');
      expect(result).toContain('[index.ts](maestro-file://index.ts)');
    });

    it('does not convert non-existent paths', async () => {
      const result = await processMarkdown(
        'See NonExistent/Path/File for details.',
        sampleFileTree,
        ''
      );
      expect(result).not.toContain('maestro-file://');
      expect(result).toContain('NonExistent/Path/File');
    });

    it('does not convert URLs', async () => {
      const result = await processMarkdown(
        'Visit https://example.com/path/file for more.',
        sampleFileTree,
        ''
      );
      expect(result).not.toContain('maestro-file://');
    });

    it('handles multiple path references in same text', async () => {
      const result = await processMarkdown(
        'See OPSWAT/Meetings/OP-0088 and OPSWAT/Meetings/OP-0200 for details.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[OPSWAT/Meetings/OP-0088](maestro-file://OPSWAT/Meetings/OP-0088.md)');
      expect(result).toContain('[OPSWAT/Meetings/OP-0200](maestro-file://OPSWAT/Meetings/OP-0200.md)');
    });
  });

  describe('wiki-style references', () => {
    it('converts wiki link to matching file', async () => {
      const result = await processMarkdown(
        'See [[TODO]] for tasks.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[TODO](maestro-file://Notes/TODO.md)');
    });

    it('converts wiki link with full path', async () => {
      const result = await processMarkdown(
        'Check [[OPSWAT/Meetings/OP-0088]] for meeting notes.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[OPSWAT/Meetings/OP-0088](maestro-file://OPSWAT/Meetings/OP-0088.md)');
    });

    it('converts wiki link with .md extension', async () => {
      const result = await processMarkdown(
        'See [[README.md]] for info.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[README.md](maestro-file://README.md)');
    });

    it('does not convert non-existent wiki links', async () => {
      const result = await processMarkdown(
        'See [[NonExistent File]] for details.',
        sampleFileTree,
        ''
      );
      // Should not create a maestro-file link for non-existent files
      expect(result).not.toContain('maestro-file://');
      // The brackets will be escaped by remark-stringify
      expect(result).toContain('NonExistent File');
    });

    it('handles multiple wiki links in same text', async () => {
      const result = await processMarkdown(
        'Check [[TODO]] and [[README.md]] for updates.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[TODO](maestro-file://Notes/TODO.md)');
      expect(result).toContain('[README.md](maestro-file://README.md)');
    });

    it('converts wiki link with alias (pipe syntax)', async () => {
      const result = await processMarkdown(
        'Established in 2024: [[Notes/TODO|my tasks]]',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[my tasks](maestro-file://Notes/TODO.md)');
    });

    it('converts wiki link with alias and spaces in display text', async () => {
      const result = await processMarkdown(
        'See [[OPSWAT/README|OPSWAT Documentation]] for details.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[OPSWAT Documentation](maestro-file://OPSWAT/README.md)');
    });

    it('converts wiki link with alias preserving original display', async () => {
      const result = await processMarkdown(
        'Check the [[config.json|configuration file]] settings.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[configuration file](maestro-file://config.json)');
    });

    it('handles alias with complex path', async () => {
      const result = await processMarkdown(
        'Meeting details: [[OPSWAT/Meetings/OP-0088|ELT Call Notes]]',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[ELT Call Notes](maestro-file://OPSWAT/Meetings/OP-0088.md)');
    });
  });

  describe('duplicate filename resolution', () => {
    it('picks closest file to cwd when multiple matches exist', async () => {
      // With cwd in Notes, Notes/Meeting Notes.md should be closer
      const result = await processMarkdown(
        'See [[Meeting Notes]] for details.',
        sampleFileTree,
        'Notes'
      );
      // remark-stringify wraps URLs with spaces in angle brackets
      expect(result).toContain('[Meeting Notes](<maestro-file://Notes/Meeting Notes.md>)');
    });

    it('picks file in Archive when cwd is Archive', async () => {
      const result = await processMarkdown(
        'See [[Meeting Notes]] for details.',
        sampleFileTree,
        'Archive'
      );
      // remark-stringify wraps URLs with spaces in angle brackets
      expect(result).toContain('[Meeting Notes](<maestro-file://Archive/Meeting Notes.md>)');
    });

    it('disambiguates with partial path', async () => {
      const result = await processMarkdown(
        'See [[Notes/Meeting Notes]] for details.',
        sampleFileTree,
        ''
      );
      // remark-stringify wraps URLs with spaces in angle brackets
      expect(result).toContain('[Notes/Meeting Notes](<maestro-file://Notes/Meeting Notes.md>)');
    });
  });

  describe('edge cases', () => {
    it('handles empty file tree', async () => {
      const result = await processMarkdown(
        'See OPSWAT/Meetings/OP-0088 for details.',
        [],
        ''
      );
      expect(result).not.toContain('maestro-file://');
      expect(result).toContain('OPSWAT/Meetings/OP-0088');
    });

    it('handles text with no file references', async () => {
      const result = await processMarkdown(
        'This is just regular text with no file references.',
        sampleFileTree,
        ''
      );
      expect(result).not.toContain('maestro-file://');
      expect(result).toContain('This is just regular text');
    });

    it('preserves existing markdown links', async () => {
      const result = await processMarkdown(
        'Check [Google](https://google.com) for search.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[Google](https://google.com)');
    });

    it('handles file references inside code blocks (should not convert)', async () => {
      const result = await processMarkdown(
        '```\nOPSWAT/Meetings/OP-0088\n```',
        sampleFileTree,
        ''
      );
      // Code blocks content should remain unchanged
      expect(result).toContain('OPSWAT/Meetings/OP-0088');
    });

    it('handles inline code (should not convert)', async () => {
      const result = await processMarkdown(
        'Run `OPSWAT/Meetings/OP-0088` command.',
        sampleFileTree,
        ''
      );
      // The plugin operates on text nodes, inline code is a different node type
      expect(result).toContain('`OPSWAT/Meetings/OP-0088`');
    });

    it('handles mixed path and wiki links', async () => {
      const result = await processMarkdown(
        'See OPSWAT/README.md and [[TODO]] for info.',
        sampleFileTree,
        ''
      );
      expect(result).toContain('[OPSWAT/README.md](maestro-file://OPSWAT/README.md)');
      expect(result).toContain('[TODO](maestro-file://Notes/TODO.md)');
    });
  });

  describe('proximity calculation', () => {
    it('calculates proximity correctly for nested paths', async () => {
      // Create a tree where files are at different depths
      const deepTree: FileNode[] = [
        {
          name: 'a',
          type: 'folder',
          children: [
            {
              name: 'b',
              type: 'folder',
              children: [
                { name: 'target.md', type: 'file' }
              ]
            }
          ]
        },
        {
          name: 'x',
          type: 'folder',
          children: [
            { name: 'target.md', type: 'file' }
          ]
        }
      ];

      // With cwd at 'a/b', the a/b/target.md should be closest
      const result = await processMarkdown(
        'See [[target]] for details.',
        deepTree,
        'a/b'
      );
      expect(result).toContain('[target](maestro-file://a/b/target.md)');
    });
  });

  describe('absolute path references', () => {
    it('converts absolute paths when projectRoot is provided', async () => {
      const result = await processMarkdown(
        'See /Users/pedram/Project/OPSWAT/README.md for details.',
        sampleFileTree,
        '',
        '/Users/pedram/Project'
      );
      expect(result).toContain('[/Users/pedram/Project/OPSWAT/README.md](maestro-file://OPSWAT/README.md)');
    });

    it('does not convert absolute paths outside projectRoot', async () => {
      const result = await processMarkdown(
        'See /other/path/README.md for details.',
        sampleFileTree,
        '',
        '/Users/pedram/Project'
      );
      // Should not be converted since it's outside projectRoot
      expect(result).toContain('/other/path/README.md');
      expect(result).not.toContain('maestro-file://');
    });

    it('does not convert absolute paths when projectRoot is not provided', async () => {
      const result = await processMarkdown(
        'See /Users/pedram/Project/OPSWAT/README.md for details.',
        sampleFileTree,
        ''
      );
      // Should not be converted since projectRoot is not provided
      expect(result).toContain('/Users/pedram/Project/OPSWAT/README.md');
      expect(result).not.toContain('maestro-file://');
    });

    it('handles absolute paths with spaces in folder/file names', async () => {
      const result = await processMarkdown(
        'See /Users/pedram/Project/Notes/Meeting Notes.md for details.',
        sampleFileTree,
        '',
        '/Users/pedram/Project'
      );
      // remark-stringify wraps URLs with spaces in angle brackets
      expect(result).toContain('[/Users/pedram/Project/Notes/Meeting Notes.md](<maestro-file://Notes/Meeting Notes.md>)');
    });
  });
});
