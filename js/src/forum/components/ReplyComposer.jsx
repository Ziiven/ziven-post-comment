// ReplyComposer — a small inline textarea + submit button for writing a
// nested reply. Posts a new post with parentPost relationship pointing
// back to the parent comment.

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

  submit() {
    const content = (this.content || '').trim();
    if (!content) return;
    if (this.loading) return;

    this.loading = true;
    this.error = null;
    m.redraw();

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
        m.redraw();
        if (typeof this.attrs.onposted === 'function') {
          this.attrs.onposted(newPost);
        }
      })
      .catch((e) => {
        this.loading = false;
        this.error = (e && (e.message || e.toString())) || 'Failed to post reply';
        m.redraw();
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
            this.content = e.target.value;
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
