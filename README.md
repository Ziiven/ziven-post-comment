# Ziven Post Comment

A Flarum 2.0 extension that adds **single-level nested replies** (楼中楼) to top-level comments.

- Replies are rendered inline under the parent comment, with a blue left border and a compact avatar.
- The first 3 replies are always visible; a **"View N more replies"** button lazy-loads the rest.
- A **"Reply"** action on each top-level comment opens an inline mini-composer.
- The author of the parent post receives a **`postCommented`** notification (configurable in user preferences).
- Single-level only: replies cannot themselves be replied to (flat one-layer thread).

## Visual

- Light + dark theme support
- Responsive: collapses to smaller avatar / padding on mobile (`@phone`)

## Installation (local MAMP path repo)

```bash
cd /Applications/MAMP/htdocs/Flarum
composer require ziiven/ziven-post-comment
php flarum migrate
php flarum cache:clear
php flarum extension:enable ziven-post-comment
```

## Build (front-end)

```bash
cd packages/ziven-post-comment
npm install
npm run build   # → js/dist/forum.js
```

## API

- `POST /api/posts` — accepts `relationships.parentPost.data.id` to create a nested reply.
- `GET /api/posts?filter[parent]=null` — list top-level comments.
- `GET /api/posts?filter[parent]=123` — list replies to post #123.
- `GET /api/posts?filter[replyCount]=0` — posts with no replies.
- Post JSON:API now exposes `isReply`, `repliesCount`, `parentPost`, `replies`.

## License

MIT
