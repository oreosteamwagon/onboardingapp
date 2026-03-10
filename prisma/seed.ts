import { PrismaClient, Role } from '@prisma/client'
import argon2 from 'argon2'

const prisma = new PrismaClient()

async function main() {
  const passwordHash = await argon2.hash('T34mw0rk!', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 4,
  })

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@localhost',
      passwordHash,
      role: Role.ADMIN,
      active: true,
    },
  })

  console.log('Seeded admin user:', admin.username)

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
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
