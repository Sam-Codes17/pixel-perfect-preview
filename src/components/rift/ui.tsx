import { Link } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { LayoutDashboard, ArrowLeftRight, CreditCard, Wallet, FileText, Search, ChevronDown, LayoutGrid, LifeBuoy, PlusCircle, ShieldCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
const nav = [
 {to:"/",label:"Dashboard",icon:LayoutDashboard}, {to:"/activity",label:"Transactions",icon:ArrowLeftRight}, {to:"/cards",label:"My cards",icon:CreditCard}, {to:"/transfer",label:"Payment",icon:Wallet}, {to:"/rfm",label:"RIFT Money",icon:FileText},
] as const;
export function AppShell({children,search,onSearch}: {children:ReactNode;search?:string;onSearch?:(value:string)=>void}) {
 const [compact,setCompact]=useState(false); const [dialog,setDialog]=useState<"account"|"support"|null>(null);
 return <div className={`bank-frame ${compact?"compact-view":""}`}>
  <aside className="bank-sidebar">
   <Link to="/" className="bank-brand"><span className="brand-mark"/>RIFT Bank</Link>
   <div className="sidebar-profile mt-10 mb-6">
    <Button variant="ghost" className="w-full h-auto p-0 justify-start mb-4" onClick={()=>setDialog("account")}><span className="profile-avatar">SJ</span><span className="text-left font-normal"><span className="block text-xs">Samarth J.</span><span className="block text-[10px] text-muted-foreground">Personal account</span></span><ChevronDown className="ml-auto"/></Button>
    <Button variant="ghost" size="sm" className="text-muted-foreground px-2 text-[11px]" onClick={()=>setDialog("account")}><PlusCircle/>Add account</Button>
   </div>
   <nav className="bank-nav" aria-label="Main navigation">{nav.map(n=><Link key={n.to} to={n.to} activeOptions={{exact:true}} activeProps={{className:"active"}}><n.icon/>{n.label}{n.to==="/activity"&&<span className="ml-auto bg-primary text-primary-foreground rounded-full px-1.5 text-[10px]">5</span>}</Link>)}</nav>
   <div className="sidebar-bottom mt-auto pt-24"><div className="border-t pt-5 grid gap-3"><Button variant="ghost" size="sm" className="justify-start text-muted-foreground px-2 text-[11px]" onClick={()=>setDialog("support")}><LifeBuoy/>Help & Support</Button><span className="flex gap-3 px-2 text-[10px] text-muted-foreground items-center"><ShieldCheck className="size-4"/>Demo · not connected</span></div></div>
  </aside>
  <div className="bank-body">
   <header className="bank-topbar">
    <div className="search-box relative w-[265px]"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground"/><input aria-label="Search transactions" value={search} onChange={e=>onSearch?.(e.target.value)} placeholder={onSearch?"Search here…":"RIFT Bank"} readOnly={!onSearch} className="bg-card w-full h-9 rounded-full pl-10 pr-3 text-xs outline-none focus:ring-1 focus:ring-ring"/></div>
    <div className="topbar-actions flex gap-3 items-center"><Button asChild className="rounded-full h-9 text-xs px-5"><Link to="/transfer"><Wallet/><span className="action-label">Send money</span></Link></Button><Button variant="secondary" className="rounded-full h-9 text-xs px-4" title="Change transaction density" onClick={()=>setCompact(!compact)} aria-pressed={compact}><span className="action-label">Change view</span><LayoutGrid/></Button></div>
   </header>
   <main>{children}</main>
  </div>
  {dialog&&<div className="fixed inset-0 z-50 bg-background/80 flex items-center justify-center p-5" onClick={()=>setDialog(null)}><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="panel p-6 w-full max-w-sm border" onClick={e=>e.stopPropagation()}><div className="flex justify-between items-center"><h2 id="dialog-title" className="text-lg">{dialog==="account"?"Personal account":"Help & Support"}</h2><Button variant="ghost" size="icon" aria-label="Close dialog" onClick={()=>setDialog(null)}><X/></Button></div><p className="text-muted-foreground text-sm mt-4">{dialog==="account"?"Account management will be available when RIFT Bank is connected. No account has been created yet.":"RIFT Bank is currently a frontend demo. Payments, cards, and account support are not connected yet."}</p></section></div>}
 </div>;
}
export function PageHeader({kicker,title,children}:{kicker:string;title:string;children?:ReactNode}) {return <div className="mb-7"><p className="label-mono mb-1">{kicker}</p><h1 className="text-2xl font-medium">{title}</h1>{children&&<p className="text-muted-foreground text-sm mt-2 max-w-2xl">{children}</p>}</div>;}
export function Panel({title,children,className=""}:{title?:string;children:ReactNode;className?:string}) {return <section className={`panel p-5 ${className}`}>{title&&<h2 className="text-sm mb-4">{title}</h2>}{children}</section>;}
export function Empty({children}:{children:ReactNode}) {return <div className="py-8 text-center text-sm text-muted-foreground">{children}</div>;}
export function Status({tone="muted",children}:{tone?:"muted"|"ok"|"warn"|"bad";children:ReactNode}) {const c={muted:"text-muted-foreground",ok:"text-success",warn:"text-warning",bad:"text-destructive"}[tone];return <span className={`inline-flex items-center gap-1.5 text-xs ${c}`}><span className="size-1.5 rounded-full bg-current"/>{children}</span>;}
export function Field({label,children}:{label:string;children:ReactNode}) {return <label className="block"><span className="label-mono">{label}</span><div className="mt-1.5">{children}</div></label>;}
export const inputCls="w-full h-10 rounded-md bg-background border px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring";
export const btnPrimary="h-10 rounded-full bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed";
export function PaymentCard({variant="gold"}:{variant?:"gold"|"purple"}) {return <div className={`payment-card ${variant}`}><div className="flex justify-between items-start"><div><p className="card-title">{variant==="gold"?"Premium":"RIFT Network."}</p>{variant==="gold"&&<p className="text-sm">**** **** **** 1777</p>}</div>{variant==="purple"&&<span className="card-emblem"><ShieldCheck className="size-4"/></span>}</div><div className="card-footer"><span>{variant==="gold"?"Samarth Jagdale":"**** **** **** 5644"}</span><span>07/26</span></div></div>;}
