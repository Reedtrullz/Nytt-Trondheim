# SSH host key rotation

The deploy workflow pins the production VPS host key from ops/ssh/known_hosts
instead of trusting the network with runtime ssh-keyscan. The pinned key is:

    SHA256:jqrn83QeSlKz9fTXj9Tilyjn7m5Dy8IGx+slNFpn8ow (ED25519)

To rotate the host key on the VPS:

1. Generate the new key pair and verify the new fingerprint out of band.
2. Update ops/ssh/known_hosts in a reviewed pull request.
3. Merge only after the new fingerprint has been confirmed against the VPS.

Never regenerate this file by scanning the host during an incident; that defeats
the pinning protection.
