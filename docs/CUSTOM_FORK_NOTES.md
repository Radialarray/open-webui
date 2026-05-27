# Custom Fork Notes

This repository is **not** a stock Open WebUI checkout. It contains local customizations plus downstream fixes that must be considered whenever rebasing or upgrading to a newer upstream release.

Use this file as the handoff/reference document for future upgrades.

## Current Deployment Reference

- Git branch: `main`
- Live server: LXC `119`
- Live app URL: `http://192.168.1.19:8080`
- Current custom image tag: `open-webui-custom:rebased-v0.9.5-multimodel-fix`

## Important Customizations To Preserve

These are the user-visible custom fork behaviors that should be checked after any upstream upgrade/rebase.

### 1. Custom chat navbar / selector polish

Primary files:

- `src/lib/components/chat/Navbar.svelte`
- `src/lib/components/chat/ModelSelector.svelte`
- `src/lib/components/chat/ModelSelector/ModelItem.svelte`
- `src/lib/components/chat/Messages/MultiResponseMessages.svelte`

Behavior to preserve:

- custom chat header / model selector UX polish
- custom view-selection dropdown next to model selector
- selector/layout polish previously restored in:
  - `0ef281ee0 fix: restore chat selector polish`

When upgrading, manually verify that the custom dropdown is still present and that the chat header still matches the current custom UI.

### 2. Multi-response rendering behavior

Primary file:

- `src/lib/components/chat/Messages/MultiResponseMessages.svelte`

Behavior to preserve:

- per-model column/tab selection stays aligned to the correct response branch
- active highlight tracks the correct branch
- render keys do not cause duplicate content to appear across columns
- branch switching and grouped responses remain stable after reload/regeneration

### 3. Settings/default-model persistence behavior

Primary files:

- `src/lib/components/chat/SettingsModal.svelte`
- `src/lib/components/chat/ModelSelector.svelte`
- `src/lib/components/workspace/Models.svelte`
- `src/lib/components/layout/Sidebar.svelte`
- `src/lib/components/layout/Sidebar/UserMenu.svelte`
- `src/lib/components/layout/Sidebar/PinnedModelList.svelte`
- `src/lib/components/admin/Settings/Models.svelte`
- `src/lib/components/ChangelogModal.svelte`
- `src/lib/components/chat/Settings/Interface.svelte`

Behavior to preserve:

- settings changes must persist using fresh cloned settings, not stale `$settings`
- default model from config must **not** overwrite a user-selected default model
- pinned-model and related UI settings must survive reload

## Downstream Fixes Applied In This Fork

## A. Multi-model chat state preservation

Commit:

- `9be20dda7 fix: preserve multi-model chat state`

Primary files:

- `backend/open_webui/main.py`
- `backend/open_webui/models/chats.py`
- `src/lib/components/chat/Chat.svelte`
- `src/lib/components/chat/Messages/MultiResponseMessages.svelte`

What it fixed:

- assistant placeholders now persist stable `modelIdx`
- reload/follow-up paths no longer collapse multi-model responses onto the wrong branch
- `history.currentId` no longer gets overwritten on every assistant update
- frontend branch `0` now works correctly (`nullish` handling instead of falsy check)

Symptoms if lost:

- multi-model chats look correct at first, then collapse after reload
- branch `0` behaves differently from other branches
- active model highlight jumps to wrong response

## B. Duplicate same-model multi-response preservation

Commit:

- `7b2e8e754 fix: preserve duplicate model responses`

Primary files:

- `src/lib/components/chat/Chat.svelte`
- `backend/open_webui/main.py`

What it fixed:

- selecting the **same model more than once** now creates separate response slots
- frontend no longer sends a multi-model placeholder map keyed only by `modelId`
- backend now supports an ordered slot list:
  - `{ model, modelIdx, messageId }`
- backend still accepts the older legacy map format for compatibility

Why this mattered:

- old behavior used `{ [modelId]: messageId }`
- duplicate model selections overwrote earlier entries
- only one generation task actually survived, and UI then reused the same result in multiple slots

Symptoms if lost:

- choosing the same model twice shows cloned output in both slots
- only one generation runs when duplicate same-model slots are selected

## C. Settings persistence and default-model protection

Commits were applied across working history rather than as one dedicated documentation-only commit.

Primary behavior:

- use cloned/fresh settings objects before `updateUserSettings(...)`
- never send stale `$settings` immediately after `settings.set(...)`
- only apply `config.default_models` if user default selection is empty

Symptoms if lost:

- model/default settings revert after reload
- pinned models revert or reorder unexpectedly
- config defaults override user choice

## Reapply Checklist For Future Upgrades

When rebasing onto a newer upstream tag/branch, do this in order.

### 1. Reapply custom UI behavior

Inspect and compare these files first:

- `src/lib/components/chat/Navbar.svelte`
- `src/lib/components/chat/ModelSelector.svelte`
- `src/lib/components/chat/ModelSelector/ModelItem.svelte`
- `src/lib/components/chat/Messages/MultiResponseMessages.svelte`

Confirm:

- custom dropdown next to model selector still exists
- header/selector layout still matches this fork
- multi-response rendering still uses the custom branch behavior

### 2. Reapply persistence fixes

Inspect:

- `src/lib/components/chat/SettingsModal.svelte`
- `src/lib/components/chat/ModelSelector.svelte`
- `src/lib/components/workspace/Models.svelte`
- `src/lib/components/layout/Sidebar.svelte`
- `src/lib/components/layout/Sidebar/UserMenu.svelte`
- `src/lib/components/layout/Sidebar/PinnedModelList.svelte`
- `src/lib/components/admin/Settings/Models.svelte`
- `src/lib/components/ChangelogModal.svelte`
- `src/lib/components/chat/Settings/Interface.svelte`

Look for this anti-pattern:

```ts
settings.set(...)
await updateUserSettings(localStorage.token, { ui: $settings })
```

Replace with:

```ts
const updatedSettings = { ...$settings, ...patch };
settings.set(updatedSettings);
await updateUserSettings(localStorage.token, { ui: updatedSettings });
```

### 3. Reapply multi-model backend behavior

Inspect:

- `backend/open_webui/main.py`
- `backend/open_webui/models/chats.py`
- `src/lib/components/chat/Chat.svelte`

Confirm:

- assistant placeholders persist `modelIdx`
- same-model duplicate selections use ordered `message_ids` slot targets, not a `modelId -> messageId` map
- chat message upsert does not blindly overwrite `history.currentId`

### 4. Verify locally before deploy

Minimum checks:

1. select **two different models** and confirm two distinct outputs
2. select **same model twice** and confirm two distinct outputs
3. reload chat and confirm both branches remain distinct
4. verify default model + pinned model persistence after reload
5. verify custom dropdown still exists next to model selector

## Useful Commands

### Build local image

```bash
docker buildx build --builder desktop-linux --platform linux/amd64 \
  -t open-webui-custom:rebased-v0.9.5-multimodel-fix --load .
```

### Export image

```bash
docker save open-webui-custom:rebased-v0.9.5-multimodel-fix | gzip > /tmp/open-webui.tar.gz
```

### Server redeploy pattern

From `server/` repo root:

```bash
source .env
sshpass -p "$SSH_PASSWORD" scp /tmp/open-webui.tar.gz "$SSH_USER@$SSH_HOST:/root/open-webui.tar.gz"
sshpass -p "$SSH_PASSWORD" ssh "$SSH_USER@$SSH_HOST" \
  "pct push 119 /root/open-webui.tar.gz /root/apps/open-webui/open-webui.tar.gz && \
   pct exec 119 -- sh -lc 'gzip -dc /root/apps/open-webui/open-webui.tar.gz | docker load && \
   cd /root/apps/open-webui && docker compose up -d --force-recreate open-webui'"
```

### Live verification

```bash
source .env
sshpass -p "$SSH_PASSWORD" ssh "$SSH_USER@$SSH_HOST" \
  "pct exec 119 -- sh -lc 'docker ps && wget -qO- http://127.0.0.1:8080/health && echo && wget -qO- http://127.0.0.1:8080/api/config'"
```

## Known Upgrade Hazard Areas

These files previously caused significant rebase conflicts and should be inspected early in any future rebase attempt:

- `backend/open_webui/main.py`
- `backend/open_webui/routers/openai.py`
- `src/lib/components/AddConnectionModal.svelte`
- `src/lib/components/chat/ModelSelector/ModelItem.svelte`

If a future rebase gets messy, prefer this order:

1. upstream functional changes
2. downstream persistence fixes
3. downstream multi-model fixes
4. downstream UI customizations/polish

That order reduces the chance of accidentally restoring the broken duplicate-model or stale-settings behavior.
