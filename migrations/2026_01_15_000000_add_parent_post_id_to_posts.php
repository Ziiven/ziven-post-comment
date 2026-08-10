<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Schema\Builder;

return [
    'up' => function (Builder $schema) {
        $schema->table('posts', function (Blueprint $table) {
            // Single-level nested reply: a reply post points to its parent post
            // (the post it is replying to). NULL = top-level comment in discussion.
            $table->unsignedInteger('parent_post_id')->nullable();

            // Composite index for the most common query: fetch replies for a
            // given parent, ordered by created_at. This is what NestedReplies
            // uses to render the inline thread.
            $table->index(['parent_post_id', 'created_at'], 'posts_parent_post_id_created_at_index');

            // Self-referential foreign key with cascade so a parent deletion
            // removes all its nested replies (their content would otherwise
            // be orphaned and confusing).
            $table->foreign('parent_post_id')
                ->references('id')
                ->on('posts')
                ->onDelete('cascade');
        });
    },

    'down' => function (Builder $schema) {
        $schema->table('posts', function (Blueprint $table) {
            $table->dropForeign(['parent_post_id']);
            $table->dropIndex('posts_parent_post_id_created_at_index');
            $table->dropColumn('parent_post_id');
        });
    },
];
