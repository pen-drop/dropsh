<?php

use Drupal\consumers\Entity\Consumer;
use Drupal\simple_oauth\Entity\Oauth2Scope;
use Drupal\simple_oauth\Oauth2ScopeInterface;

function ensure_scope(): Oauth2Scope {
  $storage = \Drupal::entityTypeManager()->getStorage('oauth2_scope');
  $existing = $storage->loadByProperties(['name' => 'integration:content']);
  $scope = $existing ? reset($existing) : NULL;

  $values = [
    'name' => 'integration:content',
    'description' => 'Integration test content access',
    'grant_types' => [
      'authorization_code' => [
        'status' => TRUE,
        'description' => 'Integration test authorization code scope',
      ],
      'password' => [
        'status' => TRUE,
        'description' => 'Integration test password grant scope',
      ],
      'client_credentials' => [
        'status' => TRUE,
        'description' => 'Integration test client credentials scope',
      ],
      'refresh_token' => [
        'status' => TRUE,
        'description' => 'Integration test refresh token scope',
      ],
    ],
    'umbrella' => FALSE,
    'granularity_id' => Oauth2ScopeInterface::GRANULARITY_PERMISSION,
    'granularity_configuration' => [
      'permission' => 'access content',
    ],
  ];

  if ($scope) {
    foreach ($values as $key => $value) {
      $scope->set($key, $value);
    }
    $scope->save();
    echo "Updated oauth2 scope integration:content\n";
  } else {
    $scope = Oauth2Scope::create($values);
    $scope->save();
    echo "Created oauth2 scope integration:content\n";
  }

  return $scope;
}

function ensure_consumer(string $client_id, string $label, array $grants, string $secret, array $extra = []): string {
  $storage = \Drupal::entityTypeManager()->getStorage('consumer');
  $existing = $storage->loadByProperties(['client_id' => $client_id]);
  $consumer = $existing ? reset($existing) : NULL;

  $values = array_merge([
    'label' => $label,
    'client_id' => $client_id,
    'secret' => $secret,
    'confidential' => TRUE,
    'grant_types' => $grants,
  ], $extra);

  if ($consumer) {
    foreach ($values as $key => $value) {
      $consumer->set($key, $value);
    }
    $consumer->save();
    echo "Updated consumer {$label}\n";
  } else {
    $consumer = Consumer::create($values);
    $consumer->save();
    echo "Created consumer {$label}\n";
  }

  return $consumer->get('client_id')->value;
}

// Deterministic secrets so test code can hardcode credentials.
$password_secret = 'tests-password-secret';
$cc_secret = 'tests-cc-secret';
$scope = ensure_scope();
$tester = user_load_by_name('tester');

$password_id = ensure_consumer(
  'tests-password',
  'Integration Test (password grant)',
  ['password'],
  $password_secret,
);

$cc_id = ensure_consumer(
  'tests-cc',
  'Integration Test (client_credentials grant)',
  ['client_credentials'],
  $cc_secret,
  [
    'user_id' => $tester?->id(),
    'scopes' => [$scope->id()],
  ],
);

$authcode_id = ensure_consumer(
  'tests-authcode',
  'Integration Test (auth code + pkce)',
  ['authorization_code', 'refresh_token'],
  '',
  [
    'confidential' => FALSE,
    'pkce' => TRUE,
    'automatic_authorization' => TRUE,
    'redirect' => ['http://localhost:7432/callback'],
    'authorization_code_scopes' => [$scope->id()],
  ],
);

echo 'CONSUMER_JSON:' . json_encode([
  'scope' => $scope->getName(),
  'password_client_id' => $password_id,
  'password_client_secret' => $password_secret,
  'cc_client_id' => $cc_id,
  'cc_client_secret' => $cc_secret,
  'authcode_client_id' => $authcode_id,
]) . "\n";
