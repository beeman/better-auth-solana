import type { RcFile } from 'syncpack'

const config: RcFile = {
  semverGroups: [
    {
      dependencyTypes: ['dev'],
      packages: ['better-auth-solana'],
      range: '',
    },
  ],
}

export default config
