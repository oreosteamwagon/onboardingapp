'use client'

import React, { createContext, useContext } from 'react'

interface BrandingContextValue {
  orgName: string
  logoPath: string | null
  primaryColor: string
  accentColor: string
}

const BrandingContext = createContext<BrandingContextValue>({
  orgName: 'My Organization',
  logoPath: null,
  primaryColor: '#2563eb',
  accentColor: '#7c3aed',
})

export function useBranding() {
  return useContext(BrandingContext)
}

interface BrandingProviderProps extends BrandingContextValue {
  children: React.ReactNode
}

export function BrandingProvider({
  children,
  orgName,
  logoPath,
  primaryColor,
  accentColor,
}: BrandingProviderProps) {
  return (
    <BrandingContext.Provider value={{ orgName, logoPath, primaryColor, accentColor }}>
      {children}
    </BrandingContext.Provider>
  )
}
