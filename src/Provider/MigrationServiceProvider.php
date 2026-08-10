<?php

/*
 * This file is part of ziiven/ziven-post-comment.
 *
 * For the full copyright and license information, please view the LICENSE
 * file that was distributed with this source code.
 */

namespace Ziven\PostComment\Provider;

use Flarum\Foundation\AbstractServiceProvider;
use Illuminate\Database\ConnectionInterface;

class MigrationServiceProvider extends AbstractServiceProvider
{
    public function boot(ConnectionInterface $db): void
    {
        $this->loadMigrationsFrom(__DIR__ . '/../../migrations');
    }
}
