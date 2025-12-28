---
title: Playbook Marketplace
description: Browse, preview, and import community playbooks from the Maestro Playbook Marketplace.
icon: store
---

The Playbook Marketplace is a curated collection of community-contributed playbooks that you can browse and import directly into your Auto Run folder. Each playbook is a pre-configured set of markdown documents designed for specific workflows.

## Opening the Marketplace

Open the Playbook Marketplace using:
- **Quick Actions**: `Cmd+K` → search "Playbook Marketplace"
- **Auto Run panel**: Click the **Marketplace** button

## Browsing Playbooks

The marketplace displays playbooks in a searchable grid organized by category:

- **Category tabs** filter playbooks by type (Development, Security, DevOps, etc.)
- **Search** filters by title, description, and tags
- **Arrow keys** navigate between tiles
- **Enter** opens the detail view for the selected playbook

Use `Cmd+Shift+[` / `Cmd+Shift+]` to quickly switch between category tabs.

## Playbook Details

Clicking a playbook tile opens the detail view where you can:

- **Read the README** — full documentation for the playbook
- **Preview documents** — browse individual task documents before importing
- **View metadata** — author, tags, loop settings, and document list
- **Set import folder** — customize the target folder name

## Importing a Playbook

1. Open the detail view for a playbook
2. Optionally edit the **Import to folder** field (defaults to `category/title` slug)
3. Click **Import Playbook**

The import creates:
- A subfolder in your Auto Run folder with the playbook name
- All markdown documents copied to that folder
- A saved playbook configuration with loop settings and document order

After import, the playbook is immediately available in your **Load Playbook** dropdown in the Auto Run panel.

## Marketplace Data

Playbooks are fetched from the [Maestro-Playbooks](https://github.com/pedramamini/Maestro-Playbooks) GitHub repository. The manifest is cached locally for 5 minutes to minimize API calls.

- **Cache indicator** shows whether data is from cache and how old it is
- **Refresh button** forces a fresh fetch from GitHub

## Contributing Playbooks

Want to share your playbooks with the community? See the [Maestro-Playbooks repository](https://github.com/pedramamini/Maestro-Playbooks) for contribution guidelines.

## Keyboard Shortcuts

| Action | Key |
|--------|-----|
| Navigate tiles | Arrow keys |
| Open detail view | `Enter` |
| Close / Back | `Esc` |
