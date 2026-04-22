<?php

use Drupal\user\Entity\Role;
use Drupal\user\Entity\User;

$role_id = 'integration_editor';
$role = Role::load($role_id);
if (!$role) {
  $role = Role::create(['id' => $role_id, 'label' => 'Integration Editor']);
  $role->save();
  echo "Created role {$role_id}\n";
}

$permissions = [
  'access content',
  'create article_test content',
  'edit any article_test content',
  'delete any article_test content',
  'grant simple_oauth codes',
];

foreach ($permissions as $permission) {
  if (!$role->hasPermission($permission)) {
    $role->grantPermission($permission);
  }
}
$role->save();

$username = 'tester';
$password = 'tester-pw';

$existing = \Drupal::entityTypeManager()->getStorage('user')->loadByProperties(['name' => $username]);
$user = $existing ? reset($existing) : NULL;

if (!$user) {
  $user = User::create([
    'name' => $username,
    'pass' => $password,
    'mail' => 'tester@example.com',
    'status' => 1,
  ]);
  $user->addRole($role_id);
  $user->save();
  echo "Created user {$username}\n";
} else {
  $user->setPassword($password);
  if (!in_array($role_id, $user->getRoles(), TRUE)) {
    $user->addRole($role_id);
  }
  $user->save();
  echo "Updated user {$username}\n";
}

echo "User setup complete\n";
