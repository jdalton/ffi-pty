export interface HelperPublisherPolicy {
  subject: string
  issuer?: string
}

// Exact subject verified against the Azure ffi-pty Public Trust certificate.
// Keep this in reviewed source. Never learn an approved publisher from an arbitrary binary.
export const helperPublisherPolicy: HelperPublisherPolicy = Object.freeze({
  subject:
    'CN=John-David Dalton, O=John-David Dalton, L=Midlothian, S=va, C=US',
})
