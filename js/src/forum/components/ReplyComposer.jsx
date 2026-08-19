// ReplyComposer — a small inline textarea + submit button for writing a
// nested reply. Posts a new post with parentPost relationship pointing
// back to the parent comment.
//
// v0.1.0e: P0 critical fix — `oninput` and submit button disabled state.
//
// Background (SOP 207): vendor Flarum 2.0's `SubtreeRetainer` (in
// `AbstractPost.onbeforeupdate`) locks the CommentPost subtree from
// re-rendering on most state changes. As a result, the mithril JSX
// event-attribute `oninput={(e) => { this.content = e.target.value; }}`
// is NOT reliably attached (or is attached but never re-evaluates
// `this.content` because the controlled `value={this.content}` prop
// never updates). The visible symptom is: the user types in the
// textarea, the DOM value updates (browser native), but `this.content`
// stays `''`, the submit button's `disabled` prop is computed against
// `this.content` so the button stays `disabled`, and even if you force
// the click, `submit()`'s `if (!content) return;` early-out short-
// circuits. Net effect: the entire reply form is unusable from the
// user's perspective. V 测 V5 proved this with 5 independent input
// methods (page.type, page.keyboard.type, InputEvent dispatch, force-
// click, API direct) all failing to produce a new post.
//
// Fix (v0.1.0e — Option B, the more reliable of the two options
// Mavis proposed):
//   1. `oncreate()` captures the textarea and submit button DOM
//      elements and binds a NATIVE `addEventListener('input', ...)`.
//      This handler:
//        - Updates `this.content` (so any code that still reads the
//          field via the JSX `value` prop gets a fresh value on the
//          next forced mithril re-render).
//        - Toggles the submit button's `disabled` attribute directly
//          on the DOM (since the JSX `disabled` prop can't be re-
//          evaluated by the locked-out mithril subtree).
//   2. `submit()` reads the content from the DOM (`textarea.value`)
//      instead of from `this.content`. This is the canonical
//      "single source of truth" for what's actually in the textarea.
//   3. On success, we also clear the textarea via `textarea.value = ''`
//      (we don't rely on `this.content = ''` triggering a re-render).
//   4. On error, we re-evaluate the submit button's disabled state.
//   5. mithril `m.redraw()` is still called (it does no harm if the
//      subtree is locked, and it can in some cases refresh other
//      parts of the page) — but no logic in this file depends on
//      the redraw actually happening.
//
// Why not Option A (relay the value through `NestedReplies.oncreate`
// binding the listener there)? Because the submit button is also
// inside this component, and any "wire up the parent to drive the
// child's button" wiring creates a tighter coupling than just
// letting this component manage its own DOM. Option B keeps the
// composer self-contained and only uses the parent's `onposted`
// callback (which already works) to communicate results back.
//
// v0.1.0d: NestedReplies is responsible for the visible/hidden
// toggle of this component (it wraps the composer in a container and
// toggles the container's `display` style directly via the
// `_applyComposer()` helper — see SOP 207 / 208 for why we don't
// rely on mithril re-renders here). The component itself does NOT
// take a `visible` prop; mounting it = visible. Hiding is the
// parent's job. This keeps the composer's internal state (the
// textarea content) cleanly tied to its lifetime.

import app from 'flarum/forum/app';
import Component from 'flarum/common/Component';
import Button from 'flarum/common/components/Button';

export default class ReplyComposer extends Component {
  oninit(vnode) {
    super.oninit(vnode);

    this.parentPost = this.attrs.parentPost;
    this.content = '';
    this.loading = false;
    this.error = null;
  }

  oncreate(vnode) {
    super.oncreate(vnode);

    // v0.1.0e: capture the textarea + submit button elements so we can
    // bind native event listeners directly on the DOM — the mithril
    // JSX event attributes (oninput, onclick) are unreliable here
    // because vendor Flarum 2.0's SubtreeRetainer blocks the
    // CommentPost subtree from re-rendering. See the v0.1.0e header
    // comment for the full explanation. (SOP 207 / 208 pattern.)
    this.textareaEl = vnode.dom
      ? vnode.dom.querySelector('.ReplyComposer-input')
      : null;
    this.submitBtnEl = vnode.dom
      ? vnode.dom.querySelector('.ReplyComposer-submit')
      : null;

    if (this.textareaEl) {
      // Native input listener: fires on every keystroke (including
      // paste / cut / IME composition end). The browser's default
      // textarea value updates before this listener runs, so we can
      // read `e.target.value` and use it as the canonical content.
      this.textareaEl.addEventListener('input', (e) => {
        const value = e.target.value || '';
        this.content = value;
        this._syncSubmitDisabled();
      });

      // Initial sync (the button starts disabled because the textarea
      // is empty; this just makes the disabled state explicit on the
      // real DOM element, in case mithril's render-time `disabled`
      // prop evaluation got locked out too).
      this._syncSubmitDisabled();
    }

    if (this.submitBtnEl) {
      // Native click listener: same SOP 207 / 208 rationale as the
      // input listener above. mithril's JSX `onclick={() => this.submit()}`
      // is also blocked by SubtreeRetainer (verified via console log
      // — the click handler never fires even though oncreate ran),
      // so we bind a native `click` listener that calls `this.submit()`
      // directly. `e.preventDefault()` keeps any default browser
      // behaviour out of the way; `e.stopPropagation()` prevents the
      // event from bubbling to mithril's delegated handler (which
      // would also try to call the JSX `onclick` — harmless if the
      // subtree is locked out, but cheaper to short-circuit).
      this.submitBtnEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.submit();
      });
    }
  }

  /**
   * v0.1.0e: Toggle the submit button's `disabled` attribute directly
   * on the DOM element. The JSX `disabled` prop on the Button is
   * computed from `this.content`, but with SubtreeRetainer locking
   * the subtree, the prop never re-evaluates after the user types.
   * Driving the DOM directly is the SOP 207/208 workaround.
   */
  _syncSubmitDisabled() {
    if (!this.submitBtnEl) return;
    const isEmpty = !(this.content || '').trim();
    const shouldDisable = !!this.loading || isEmpty;
    this.submitBtnEl.disabled = shouldDisable;
    if (this.loading) {
      this.submitBtnEl.classList.add('loading');
    } else {
      this.submitBtnEl.classList.remove('loading');
    }
  }

  submit() {
    // v0.1.0e: read the content from the DOM directly, not from
    // `this.content`. The textarea is the single source of truth for
    // what the user has actually typed; `this.content` may be stale
    // because the mithril JSX `oninput` handler is blocked by
    // SubtreeRetainer. (See header comment for full rationale.)
    const textarea = this.textareaEl
      || (this.$ ? this.$('.ReplyComposer-input')[0] : null);
    const rawValue = textarea ? textarea.value : (this.content || '');
    const content = (rawValue || '').trim();
    // v0.1.0e DEBUG: trace submit() entry
    console.log('[v0.1.0e ReplyComposer.submit] called content="' + content + '" loading=' + this.loading + ' textareaEl=' + !!textarea);
    if (!content) return;
    if (this.loading) return;

    this.loading = true;
    this.error = null;
    if (typeof m !== 'undefined' && m.redraw) m.redraw();
    this._syncSubmitDisabled();

    app.store
      .createRecord('posts')
      .save({
        content,
        relationships: {
          discussion: this.parentPost.discussion(),
          parentPost: this.parentPost,
        },
      })
      .then((newPost) => {
        this.loading = false;
        this.content = '';
        // v0.1.0e: clear the textarea on the DOM directly (not via a
        // re-render). The next mithril pass would do this, but the
        // SubtreeRetainer often blocks it.
        if (textarea) textarea.value = '';
        this._syncSubmitDisabled();
        if (typeof m !== 'undefined' && m.redraw) m.redraw();

        if (typeof this.attrs.onposted === 'function') {
          this.attrs.onposted(newPost);
        }
      })
      .catch((e) => {
        this.loading = false;
        this.error = (e && (e.message || e.toString())) || 'Failed to post reply';
        if (typeof m !== 'undefined' && m.redraw) m.redraw();
        this._syncSubmitDisabled();
      });
  }

  view() {
    return (
      <div className="ReplyComposer">
        <textarea
          className="ReplyComposer-input FormControl"
          rows="2"
          placeholder={app.translator.trans('ziven-post-comment.forum.post.composer_placeholder')}
          value={this.content}
          disabled={this.loading}
          oninput={(e) => {
            // v0.1.0e: this JSX handler is unreliable (see header
            // comment) — the native listener in `oncreate` is the
            // canonical handler. We keep the JSX handler for
            // defensive coverage: if mithril DOES re-render the
            // subtree for any reason, this handler keeps
            // `this.content` in sync too.
            this.content = e.target.value;
            this._syncSubmitDisabled();
          }}
        />

        <div className="ReplyComposer-controls">
          {this.error && <span className="ReplyComposer-error">{this.error}</span>}

          <Button
            className="Button Button--primary ReplyComposer-submit"
            disabled={this.loading || !(this.content || '').trim()}
            loading={this.loading}
            onclick={() => this.submit()}
          >
            {app.translator.trans('ziven-post-comment.forum.post.composer_submit')}
          </Button>
        </div>
      </div>
    );
  }
}
