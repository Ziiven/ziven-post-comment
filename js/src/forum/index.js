// Ziven Post Comment — single-level nested replies with vendor Flarum 2.0
// composer for replying.
//
// v0.1.0e.a redesign (辉哥拍板 2026-08-19 16:24, 撤回 v0.1.0e 的 A2 无限层):
//   - 单层: only top-level posts host a NestedReplies block.
//     NestedReplies themselves are leaf nodes. (WeChat 朋友圈 /
//     小黑盒 / 知乎 / 微博 all use 1-level nested replies.)
//   - B1 整张可点击: the entire main-post card (CommentPost) is
//     clickable to open the vendor Flarum 2.0 composer (走
//     `app.composer.load(NestedReplyComposer, { parentPost })`).
//     This is the 辉哥 "用 Flarum 原生 composer" requirement —
//     NOT a zpc inline composer.
//   - B2 更严: the click now ignores `.Post-header` (the entire
//     vendor header area — username / time / avatar / role badge),
//     in addition to the previous `.Post-actions`, links, and
//     `.NestedReplies` / `.NestedReply` children. The user must
//     click `.Post-body` (the post body) to trigger the reply
//     composer.
//   - C1 保留: NestedReply 整张可点击, 也走 vendor composer.
//   - D 单层后端守卫: 恢复 `RejectNestedReply` listener
//     (单层守卫, 跟 v0.1.0d 一致) — API 拒绝创建"回复的
//     回复". addDefaultInclude 改回 1 层 include.

import app from 'flarum/forum/app';
import { extend, override } from 'flarum/common/extend';
import CommentPost from 'flarum/forum/components/CommentPost';
import classList from 'flarum/common/utils/classList';

import NestedReplies from './components/NestedReplies';
import NestedReplyComposer from './components/NestedReplyComposer';

// Make `app.store`'s Post model understand the new fields. Without this the
// frontend will not know about `parentPost()`, `repliesCount()`, or `isReply()`
// (the existing Post model only has discussion / user / etc.).
import Post from 'flarum/common/models/Post';

// v0.1.0e.j (辉哥亲测 2026-08-20 18:32 移动端): vendor Flarum 2.0
// `PostStream` is a lazy-loaded chunk (vendor/forum.js:
//   flarum.reg.addChunkModule(158, 3038, "core", "forum/components/PostStream"))
// so it cannot be statically `import`ed — the chunk isn't loaded until the
// user navigates to a discussion page. We use the
// `flarum.reg.get` + `onLoad` async pattern (SOP 250) to fetch the
// class after the chunk is registered. If the chunk is already
// available (e.g. when the user is currently on a discussion page),
// `get()` returns the class directly; otherwise we wait for `onLoad`.
// Once we have the class, we extend its `view()` to filter out the
// `<div class="PostStream-timeGap">` element (and any descendants)
// that vendor renders between posts that are more than 4 days apart.
// The text content inside the timeGap ("8 天 后" / "10 天 后" / etc.)
// is purely visual and not part of any post — 辉哥 explicitly
// requested it be removed (not CSS-hidden) from the discussion page.

app.initializers.add('ziven-post-comment', () => {
  // ---- Model extension ---------------------------------------------------
  // `parentPost` and `replies` are ToOne/ToMany relationships; the field
  // helpers produce the correct `parentPost()` / `replies()` accessors.
  Post.prototype.parentPost = function () {
    return this.data.attributes.parentPost
      ? app.store.getById('posts', this.data.attributes.parentPost)
      : null;
  };
  Post.prototype.replies = function () {
    return (this.data.relationships?.replies?.data || []).map((r) => app.store.getById('posts', r.id)).filter(Boolean);
  };
  Post.prototype.repliesCount = function () {
    return this.data.attributes.repliesCount ?? 0;
  };
  Post.prototype.isReply = function () {
    return !!this.data.attributes.isReply;
  };

  // ---- CommentPost extension --------------------------------------------
  // Render the NestedReplies block under each top-level comment.
  // We use `override` here because `content()` returns a Mithril.Children[]
  // array (not an ItemList), so the `extend(pattern)` mutator doesn't fit.
  //
  // v0.1.0d (辉哥亲测发现): the first post of a discussion (number=1) must
  // NOT have a NestedReplies block. The first post IS the discussion
  // starter, and stuffing a "Reply" / composer area underneath it is
  // confusing — every "View N more" / composer / "Reply" affordance the
  // extension adds belongs to *replies* of a post, but a discussion
  // starter is a one-of-a-kind seed post whose only "reply" path is the
  // global discussion composer (not this extension's per-post composer).
  // Skipping number=1 here is also a defensive guard in case the backend
  // ever starts returning first posts with `isReply=false` but `parent
  // != null` (a likely future refactor).
  override(CommentPost.prototype, 'content', function (original) {
    const post = this.attrs.post;
    const children = original();

    // Top-level posts only, and never the first post of a discussion.
    // Reply posts themselves are leaf nodes; the discussion starter is
    // the "root" — neither gets a NestedReplies block.
    // v0.1.0e.c (辉哥亲测 2026-08-19 21:40): also skip posts that
    // have zero nested replies. Without this, top-level posts with
    // no replies still render an empty `<div class="Post-nestedReplies">`
    // border — confusing visual noise. The whole-card click handler
    // (B1, bound in `oncreate` below) is still bound for these posts,
    // so the user can still click the card to open the vendor composer
    // and create the *first* reply.
    if (post.isReply() || post.number() === 1 || post.repliesCount() === 0) {
      return children;
    }

    children.push(
      <div className="Post-nestedReplies">
        <NestedReplies post={post} />
      </div>
    );
    return children;
  });

  // Override the elementAttrs to add `Post--hasReplies` when this post has
  // nested replies, so we can show an indicator (e.g. a left border).
  // v0.1.0d: also skip the first post — the starter post never gets the
  // `Post--hasReplies` accent (it has no NestedReplies block at all).
  // v0.1.0e: also add `Post--nestedClickable` for any post that can
  // host a NestedReplies (i.e. is not a reply, is not the first
  // post), so the CSS can attach the cursor:pointer / hover effect
  // precisely where the card-click handler will fire.
  override(CommentPost.prototype, 'elementAttrs', function (original) {
    const attrs = original();
    const post = this.attrs.post;
    const canHostNested = !post.isReply() && post.number() !== 1;
    attrs.className = classList(attrs.className, {
      'Post--hasReplies': canHostNested && post.repliesCount() > 0,
      'Post--nestedClickable': canHostNested,
    });
    return attrs;
  });

  // v0.1.0e.a: bind a native `click` listener on the CommentPost
  // `<article>` to implement "click the post body to reply" (B1
  // 辉哥). The click now opens the **vendor Flarum 2.0
  // composer** (via NestedReplyComposer) — NOT a zpc inline
  // composer. The vendor "Reply" button on the post (if any) is
  // preserved (C1) and uses vendor semantics — this listener
  // is the *additional* entry point into the same vendor
  // composer.
  //
  // The listener is bound natively (not via mithril JSX
  // `onclick`) because vendor Flarum 2.0's `SubtreeRetainer`
  // blocks CommentPost subtree re-renders, which would orphan
  // any mithril-attached click handler. SOP 207 / 208 pattern.
  override(CommentPost.prototype, 'oncreate', function (original, vnode) {
    original(vnode);

    const post = this.attrs.post;
    // Only bind on top-level, non-first posts — these are the
    // ones that actually host a NestedReplies block.
    if (post.isReply() || post.number() === 1) {
      return;
    }

    const article = vnode.dom;
    if (!article || article.dataset.zpcCardClickBound) return;
    article.dataset.zpcCardClickBound = '1';

    const handler = (e) => {
      if (!e || !e.target) return;
      const t = e.target;

      // Exclusion list (B2 辉哥 task, v0.1.0e.a):
      //
      // 1. Links — username / time / vendor action links must
      //    still navigate.
      if (t.closest && t.closest('a[href]')) return;

      // 2. Vendor Post-actions (Like button, vendor Reply
      //    button, etc.) — vendor has its own click semantics.
      if (t.closest && t.closest('.Post-actions')) return;

      // 3. Vendor Post-header (B2 NEW) — the entire vendor
      //    header area (username link, time link, avatar,
      //    role badge) is a navigation area, not a "click to
      //    reply" affordance. The user must click `.Post-body`
      //    to trigger the reply composer.
      if (t.closest && t.closest('.Post-header')) return;

      // 4. NestedReplies / NestedReply children — each has
      //    its own card-click handler (NestedReply.jsx
      //    `_handleCardClick`). The child handler calls
      //    `stopPropagation()`, so this is defensive, but
      //    it's the correct layering.
      if (t.closest && t.closest('.NestedReplies, .NestedReply, .NestedReply-replies')) return;

      e.stopPropagation();
      e.preventDefault();

      // Trigger the vendor Flarum 2.0 composer (via our
      // NestedReplyComposer thunk — see NestedReplyComposer.js
      // for the rationale on thunk vs class). This is the
      // same composer experience as the discussion-level
      // Reply, but with `parentPost` set to this top-level
      // post — so the new reply is linked back to it via
      // `parent_post_id`.
      //
      // We also pass `discussion: post.discussion()` because
      // the vendor ReplyComposer is *Discussion-level* — its
      // `data()` method reads `this.attrs.discussion` and
      // our `extend()`-override of `data()` adds
      // `parentPost` alongside the existing `discussion`
      // relationship. Without `discussion` the vendor class
      // throws when computing the data to POST to
      // `/api/posts`.
      //
      // We do NOT gate on `app.session.user` / `canReply()`
      // here — vendor's own `app.composer.load` will refuse
      // to load if the user can't reply, and the failure
      // mode is a clean no-op rather than a silent dead
      // click. Gating on those conditions client-side
      // actually *breaks* the click in real-world cases
      // (e.g. the user is logged in but their `canReply`
      // is computed from a stale post snapshot, or
      // `post.discussion()` returns a placeholder during a
      // stream update). Vendor's check is the source of
      // truth.
      app.composer.load(NestedReplyComposer, {
        parentPost: post,
        discussion: post.discussion(),
      }).then(() => {
        if (!app.composer.isVisible()) {
          return app.composer.show();
        }
      });
    };

    article.addEventListener('click', handler);

    // Stash the handler on the instance so the overridden
    // `onremove` (below) can detach it cleanly.
    this._zpcCardClickHandler = handler;
  });

  // Mirror `oncreate` with `onremove` to detach the native
  // listener when the CommentPost is removed from the DOM
  // (e.g. after a post merge / split or a full discussion
  // re-fetch). Without this, removed CommentPosts would still
  // hold a closure reference, leaking memory.
  override(CommentPost.prototype, 'onremove', function (original, vnode) {
    if (this._zpcCardClickHandler && vnode && vnode.dom) {
      vnode.dom.removeEventListener('click', this._zpcCardClickHandler);
      delete vnode.dom.dataset.zpcCardClickBound;
      this._zpcCardClickHandler = null;
    }
    original(vnode);
  });

  // ---- Notification grid -------------------------------------------------
  // Allow users to opt out of the postCommented notification.
  extend('flarum/forum/components/NotificationGrid', 'notificationTypes', function (items) {
    items.add('postCommented', {
      name: 'postCommented',
      icon: 'fas fa-comment',
      label: app.translator.trans('ziven-post-comment.forum.settings.notify_post_commented_label'),
    });
  });

  // ---- PostStream view() — remove vendor PostStream-timeGap ---------------
  // v0.1.0e.j (辉哥亲测 2026-08-20 18:32 移动端): vendor Flarum 2.0 inserts
  // a `<div class="PostStream-timeGap">` between two posts when the
  // previous one was created more than 4 days ago
  // (vendor/flarum/core/js/src/forum/components/PostStream.js:64-72). The
  // visible text is rendered via
  //   `app.translator.trans('core.forum.post_stream.time_lapsed_text',
  //     { period: dayjs().add(dt, 'ms').fromNow(true) })`
  // which yields strings like "8 天 后" / "10 天 后" in zh-Hans. 辉哥
  // asked to remove this — it is purely decorative (no per-post
  // semantic value, no zpc feature references it) and is misleading
  // on discussion pages with old + new posts.
  //
  // We use `extend()` (mutator pattern, SOP 271) to walk the vnode tree
  // returned by vendor `PostStream.view()` and remove any element
  // whose `className` contains `PostStream-timeGap`. We do NOT use
  // `override()` because we want to *augment* the returned vnode, not
  // rebuild it. We also do NOT use CSS (`display: none`) because
  // 辉哥 explicitly asked for "真移除" — the element should not exist
  // in the DOM at all.
  //
  // PostStream is a lazy-loaded chunk (chunk 158, module 3038). It
  // CANNOT be statically `import`ed (webpack would compile to
  // `flarum.reg.get(...)` which returns a Promise, not a class, until
  // the chunk is loaded). SOP 250 pattern: use the webpack runtime
  // (or `flarum.reg._webpack_runtimes`) to load the chunk and grab the
  // class. The runtime is exposed on `flarum.reg` (it's how
  // webpack-internal chunks coordinate with Flarum's registry) — see
  // SOP 256 (which solved a near-identical issue for SignUpModal in
  // ziven-core v0.5.2: `wr.e(559); const mod = await wr(9509);`).
  //
  // Why not `flarum.reg.onLoad(namespace, id, cb)`? Because that
  // callback only fires for modules that go through `flarum.reg.add`
  // (synchronous registrations). For modules registered via
  // `addChunkModule` (lazy webpack chunks), `onLoad` queues the
  // callback but never fires — there's no `add()` call after the
  // webpack chunk loads. The first Puppeteer probe confirmed:
  //   `isStripped: false` even after the discussion page rendered,
  // because the queued `onLoad` callback never fired.
  const flarumReg = (typeof window !== 'undefined' && window.flarum && window.flarum.reg) || (typeof flarum !== 'undefined' && flarum.reg) || null;
  const stripTimeGap = (Cls) => {
    if (!Cls) return;
    // Idempotent: only attach once per class. (Subsequent initializer
    // runs — e.g. via HMR — would otherwise stack the `extend`.)
    if (Cls.prototype.__zpcTimeGapStripped) return;
    Cls.prototype.__zpcTimeGapStripped = true;

    extend(Cls.prototype, 'view', function (vnode) {
      // vendor PostStream.view() returns the root <div class="PostStream">,
      // with `children` = the array of PostStream-item vnodes. Each item
      // vnode in turn has `children` = [<div.PostStream-timeGap>?,
      // <article.CommentPost>, <div.Post-quoteButtonContainer>].
      // We strip the timeGap in place.
      if (vnode && Array.isArray(vnode.children)) {
        vnode.children.forEach((item) => {
          if (
            item &&
            Array.isArray(item.children) &&
            item.attrs &&
            typeof item.attrs.className === 'string' &&
            item.attrs.className.indexOf('PostStream-item') !== -1
          ) {
            item.children = item.children.filter((grandchild) => {
              if (
                grandchild &&
                grandchild.attrs &&
                typeof grandchild.attrs.className === 'string' &&
                grandchild.attrs.className.indexOf('PostStream-timeGap') !== -1
              ) {
                return false;
              }
              return true;
            });
          }
        });
      }
      return vnode;
    });
  };

  if (flarumReg) {
    // v0.1.0e.j.2: `flarum.reg.onLoad(ns, id, callback)` is the
    // canonical way to receive a class once it's been registered.
    // For SYNC registrations (vendor `add()`), the callback fires
    // immediately. For CHUNK registrations (vendor `addChunkModule`),
    // the callback fires when the webpack chunk loads AND the
    // module's `add` call runs (verified in
    // vendor/forum.js:onLoad's minified body — it checks
    // `moduleExports.has(t) && moduleExports.get(t).has(e)`, fires
    // synchronously if so, otherwise queues; the queue is drained
    // by `add()` after the chunk loads and registers the module).
    //
    // Previous attempts failed because:
    //   (a) `flarum.reg.get(...)` returns the webpack module
    //       factory FUNCTION (with `$$reentrantLock$$`) for lazy
    //       chunks — calling it as `factory()` throws
    //       "Class constructor P cannot be invoked without 'new'".
    //   (b) `moduleExports.get(...).get(...)` returns undefined
    //       before the chunk loads.
    //   (c) Calling `stripTimeGap` on the factory function (truthy)
    //       sets `__zpcTimeGapStripped` on the factory, not the
    //       class — so the `if (Cls.prototype.__zpcTimeGapStripped)`
    //       guard later lets the real class go through the no-op
    //       path silently.
    //
    // `onLoad` solves all three: it fires exactly once, with the
    // actual class as the argument, after the chunk has registered
    // via `add()`.
    flarumReg.onLoad('core', 'forum/components/PostStream', (mod) => {
      const Cls = (mod && mod.default) ? mod.default : mod;
      if (Cls) stripTimeGap(Cls);
    });
  }
});
