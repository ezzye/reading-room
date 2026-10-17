import type { Metadata } from "next";
export const metadata:Metadata={title:"Read EveryThing",description:"Your sources, your independent reading edition",icons:{icon:"/icon-192.png"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
