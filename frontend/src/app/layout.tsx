import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/theme';
import { I18nProvider } from '@/lib/i18n';

export const metadata: Metadata = {
  title: 'Attendance | BioTime',
  description: 'ZKTeco BioTime 8.5 attendance dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme class is set before the page paints (next-themes), so the server HTML can differ
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <I18nProvider>{children}</I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
