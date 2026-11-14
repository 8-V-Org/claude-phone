# Private message readback

Owner/operator CLI: node bin/phone-message-read.cjs MESSAGE_REFERENCE. References are32 lowercase hexadecimal characters (SHA256(callId), first32). This reads the exact existing file in the voice container, not the proposed briefing or a save-success log. The read uses a regular-file fd with O_NOFOLLOW, bounded JSON, matching reference/schema and returns contents plus creation time/mode/size. No caller Live tool or arbitrary filesystem path is exposed.

No new bridge action/route/public endpoint/config change is needed. Existing authenticated operator status jobs carry a private-message-read-v1 selector and ephemeral RSA public key to the voice worker. The returned job result is hybrid RSA-OAEP-SHA256/AES256-GCM ciphertext only, preventing shared shim/job-status readers from receiving plaintext inbox contents. The CLI private key exists only in its process; only it decrypts the record. Contents are not dumped to Docker logs. The owner-authorized CLI stdout can display one requested record in the private chat.

Four regression tests cover actual persisted text/mode, traversal/symlink/metadata rejection, encryption/decryption and invalid key/selectors. Combined suite107 tests passed. Voice-only deployment4fc6bf90; bridge, host Compose/env/Caddy and caller policy unchanged. No phone call made by this readback.
