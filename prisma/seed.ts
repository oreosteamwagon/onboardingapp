import { PrismaClient, Role } from '@prisma/client'
import argon2 from 'argon2'
import { randomBytes } from 'crypto'

const prisma = new PrismaClient()

async function main() {
  // Admin user: only create on first seed, never overwrite existing password
  const existingAdmin = await prisma.user.findUnique({
    where: { username: 'admin' },
    select: { id: true },
  })

  if (existingAdmin) {
    console.log('Admin user already seeded')
  } else {
    const envPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD
    let plainPassword: string
    if (envPassword && envPassword.trim().length > 0) {
      plainPassword = envPassword
      console.log('Admin password set from ADMIN_BOOTSTRAP_PASSWORD')
    } else {
      plainPassword = randomBytes(12).toString('base64url')
      console.log(`Admin password (save this): ${plainPassword}`)
    }

    const passwordHash = await argon2.hash(plainPassword, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    })

    await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@localhost',
        passwordHash,
        role: Role.ADMIN,
        active: true,
      },
    })

    console.log('Seeded admin user: admin')
  }

  await prisma.brandingSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: {
      id: 'default',
      orgName: 'My Organization',
      primaryColor: '#2563eb',
      accentColor: '#7c3aed',
    },
  })

  console.log('Seeded default branding')

  const BUILTIN_CATEGORIES = [
    { id: 'builtin-general',    slug: 'general',    name: 'General' },
    { id: 'builtin-policy',     slug: 'policy',     name: 'Policy' },
    { id: 'builtin-benefits',   slug: 'benefits',   name: 'Benefits' },
    { id: 'builtin-onboarding', slug: 'onboarding', name: 'Onboarding' },
  ]
  for (const cat of BUILTIN_CATEGORIES) {
    await prisma.documentCategory.upsert({
      where: { id: cat.id },
      update: {},
      create: { id: cat.id, slug: cat.slug, name: cat.name, isBuiltIn: true },
    })
  }

  console.log('Seeded built-in document categories')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
