# Create Article Workflow

Create a Drupal article node through dropsh.

## Steps

1. Confirm authentication.

   ```bash
   dropsh auth status
   ```

2. Search for existing articles with a similar title.

   ```bash
   dropsh search node --bundle=article --filter='title:Example title' --limit=5
   ```

3. Load a create schema.

   ```bash
   dropsh schema node/article --for=create --refresh
   ```

4. Build the JSON:API payload from the schema. Include required attributes and
   relationships reported by the schema. Do not add fields that are not present
   in the schema.

5. Validate with a dry run.

   ```bash
   dropsh create node --bundle=article --data=@article.json --dry-run
   ```

6. Create the article.

   ```bash
   dropsh create node --bundle=article --data=@article.json
   ```

7. Read the created record and verify the stored values.

   ```bash
   dropsh read node/article/<uuid>
   ```

## Error Handling

- If the schema source is `heuristic`, keep the payload minimal and prefer fields
  observed in existing records.
- If validation reports a missing required field, refresh the schema and add the
  field explicitly.
- If Drupal rejects permissions, stop and report the missing operation permission
  instead of retrying with guessed payload changes.
