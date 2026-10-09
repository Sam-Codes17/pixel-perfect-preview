import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CircleDollarSign, Database, Wallet, ChevronDown, Plus, TrendingUp } from "lucide-react";
import { AppShell, PaymentCard } from "@/components/rift/ui";
import { Button } from "@/components/ui/button";
import { demoTransactions } from "@/components/rift/demo";
export const Route = createFileRoute("/")({
 head:()=>({meta:[{title:"RIFT Bank — Dashboard"},{name:"description",content:"Your RIFT Bank financial overview, payments, cards and transactions."},{property:"og:title",content:"RIFT Bank — Dashboard"},{property:"og:description",content:"Your financial overview with RIFT Bank."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary"}]}),component:Overview,
});
function RevenueChart({account}:{account:string}) {
 const [day,setDay]=useState(3);
 return <svg viewBox="0 0 560 220" className="revenue-chart" role="img" aria-label={`${account} demo revenue chart for Monday through Sunday`}>
  {[35,108,181].map((y,i)=><g key={y}><line className="chart-grid" x1="55" y1={y} x2="550" y2={y}/><text className="chart-label" x="0" y={y+4}>{["$2000","$1000","$0"][i]}</text></g>)}
  <path className="chart-line-purple" d="M65 47 C100 132 130 99 156 112 S209 158 235 113 S287 -12 328 48 S392 141 420 90 S461 112 475 123 S515 133 550 100"/>
  <path className="chart-line-gold" d="M58 60 C85 81 125 100 154 95 S191 20 235 37 S289 60 320 96 S358 92 382 118 S436 150 455 112 S485 62 510 88 S528 118 550 130"/>
  <g transform={`translate(${[65,146,228,310,390,470,548][day]},${[64,93,42,87,124,93,127][day]})`}><circle r="7" fill="var(--card)" stroke="var(--foreground)" strokeWidth="3"/><rect x="4" y="-29" width="45" height="21" rx="9" fill="var(--muted)"/><text x="9" y="-15" className="chart-label">${["1,280","980","1,920","1,790","890","1,420","720"][day]}</text></g>
  {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((label,i)=><g key={label} onClick={()=>setDay(i)} className="cursor-pointer"><rect x={50+i*79} y="192" width="48" height="28" fill="transparent"/><text className="chart-text" x={64+i*79} y="215" fill={day===i?"var(--lavender)":undefined}>{label}</text></g>)}
 </svg>;
}
function Overview(){
 const [search,setSearch]=useState("");const [period,setPeriod]=useState("week");const [account,setAccount]=useState("Premium");
 const rows=demoTransactions.filter(t=>`${t.name} ${t.type} ${t.status}`.toLowerCase().includes(search.toLowerCase())).filter((_,i)=>period!=="week"||i<4);
 return <AppShell search={search} onSearch={setSearch}>
  <div className="dashboard-heading"><div><h1>Dashboard</h1><p>Let’s manage your finance wallet</p></div><div className="metric-row">
   {[{icon:CircleDollarSign,value:"$989.80",label:"Weekly totals",change:"+12%"},{icon:Database,value:"$4,245.29",label:"Monthly totals",change:"-3%"},{icon:Wallet,value:"$25,289.29",label:"Annual totals",change:"14%"}].map(m=><div className="metric" key={m.label}><span className="metric-icon"><m.icon className="size-4"/></span><div><div className="metric-value">{m.value}</div><div className="metric-label">{m.label}</div></div><span className={`metric-change ${m.change.startsWith("-")?"negative":""}`}>{m.change}</span></div>)}
  </div></div>
  <div className="overview-grid"><section className="revenue-panel"><div className="flex justify-between gap-3 items-start"><div><p className="text-xs text-muted-foreground mb-1.5">Revenue</p><div className="flex gap-3 items-center"><span className="revenue-number">{account==="Premium"?"$37,432.77":"$25,289.29"}</span><TrendingUp className="text-lavender size-7 hidden xl:block"/><span className="text-lavender text-xs">+33%</span></div></div><div className="text-right"><label className="relative inline-flex items-center"><select aria-label="Revenue account" value={account} onChange={e=>setAccount(e.target.value)} className="appearance-none bg-secondary text-xs rounded-lg py-2 pl-3 pr-8 outline-none"><option>Premium</option><option>RIFT Network</option></select><ChevronDown className="absolute right-2 size-3 pointer-events-none"/></label><div className="flex gap-3 mt-3 text-[10px] text-muted-foreground justify-end"><span className="flex items-center gap-1"><i className="size-1.5 bg-primary rounded-full"/>Premium</span><span className="flex items-center gap-1"><i className="size-1.5 bg-lavender rounded-full"/>RIFT Network</span></div></div></div><RevenueChart account={account}/></section>
   <section className="cards-panel"><div className="flex items-center justify-between mb-3"><h2 className="text-base">My Card</h2><Button asChild variant="ghost" size="icon" className="size-7 rounded-full border border-primary text-primary" title="Manage cards"><Link to="/cards"><Plus/></Link></Button></div><div className="card-stack grid gap-3"><PaymentCard/><PaymentCard variant="purple"/></div></section>
  </div>
  <section className="transactions-panel"><div className="flex items-center justify-between mb-2"><h2 className="text-base">Transactions</h2><label className="relative"><select aria-label="Transaction period" value={period} onChange={e=>setPeriod(e.target.value)} className="appearance-none bg-secondary text-xs rounded-lg py-2 pl-3 pr-8 outline-none"><option value="week">This week</option><option value="month">This month</option></select><ChevronDown className="absolute right-2 top-2.5 size-3 pointer-events-none"/></label></div>
   <div className="overflow-x-auto"><table className="transaction-table"><thead><tr>{["Name","Amount","Date","Type","Status"].map(c=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map(t=><tr key={t.name}><td><div className="transaction-name"><span className={`transaction-avatar ${t.tone}`}>{t.initials}</span>{t.name}</div></td><td>${t.amount.toFixed(2)}</td><td>{t.date}</td><td><span className={`type-pill ${t.tone}`}>{t.type}</span></td><td>{t.status}</td></tr>)}</tbody></table>{rows.length===0&&<p className="text-muted-foreground text-center py-8">No matching transactions.</p>}</div>
  </section><p className="text-[10px] text-muted-foreground mt-3 flex items-center gap-1.5"><span className="size-1 rounded-full bg-primary"/>Illustrative balances, cards, and transactions · no real money or connected accounts</p>
 </AppShell>;
}
