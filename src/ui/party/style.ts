// Party screens: the one style sheet (every visual in one place, code-drawn, the game's look).
// Colours and fonts are the game's tokens from site/css/style.css (--wall, --wall-hi, --paper, --ink, --mute, --red,
// --amber, --ok, --cream, --formica, --booth, --rule, --display, --body); the fallbacks here are the same values, so the
// screens look the same mounted in the game page or anywhere else. The cream-card / dark-green look with 3 px ink borders
// and hard drop shadows is the game's end card and station pages.
//
// Sizes are in the party unit --pu, which mountParty sets from the measured width of the element it draws in (not the
// window: the game is used full-width, half-width and on a portrait monitor). 1 --pu is 15-18 px.
export const PARTY_CSS = `
.pty{--pu:16px;--wall_:var(--wall,#235648);--wallhi_:var(--wall-hi,#2f6b5a);--paper_:var(--paper,#fbfaf1);--chalk_:#fbf6e2;--ink_:var(--ink,#1c2924);
  --mute_:var(--mute,#58695f);--red_:var(--red,#c8323c);--amber_:var(--amber,#cf861a);--ok_:var(--ok,#2a8b67);--cream_:var(--cream,#f4efd9);
  --formica_:var(--formica,#f3e5b2);--booth_:var(--booth,#a5372f);--rule_:var(--rule,#9cc4b2);--line_:#0f1a16;--gold_:#ffd25a;--grey_:#cfc6a8;
  --disp_:var(--display,"Noto Serif HK","Songti TC",serif);--body_:var(--body,"Noto Sans HK","PingFang HK","Microsoft JhengHei",system-ui,sans-serif);
  --bw:3px;--sh:0 calc(var(--pu)*.25) 0 var(--line_);--gap:calc(var(--pu)*.6);
  --t-safe:var(--ok_);--t-bet:var(--amber_);--t-allin:var(--red_);
  position:relative;height:100%;display:flex;flex-direction:column;background:var(--wall_);color:var(--cream_);font-family:var(--body_);
  font-size:var(--pu);line-height:1.45;box-sizing:border-box;overflow:hidden;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
.pty *,.pty *::before,.pty *::after{box-sizing:border-box}
:where(.pty) button{font:inherit;color:inherit;cursor:pointer;touch-action:manipulation}
:where(.pty) button:disabled{cursor:default}
.pty button:focus-visible{outline:3px solid var(--formica_);outline-offset:2px}

/* frame: wall strip, timer, body, action bar */
.pty-top{flex:0 0 auto;display:flex;align-items:center;gap:var(--gap);padding:calc(env(safe-area-inset-top,0px) + var(--pu)*.5) max(var(--pu),env(safe-area-inset-right,0px)) calc(var(--pu)*.5) max(var(--pu),env(safe-area-inset-left,0px));background:var(--wall_);border-bottom:var(--bw) solid var(--line_)}
.pty-where{flex:1 1 auto;min-width:0;display:flex;flex-direction:column}
.pty-where b{font-family:var(--disp_);font-size:calc(var(--pu)*1.25);line-height:1.1;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-where span{font-size:calc(var(--pu)*.72);letter-spacing:.12em;color:var(--rule_);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-bank{flex:0 0 auto;display:flex;flex-direction:column;align-items:flex-end;font-size:calc(var(--pu)*.68);color:var(--rule_);letter-spacing:.1em}
.pty-bank b{font-size:calc(var(--pu)*1.35);line-height:1.05;color:var(--gold_);font-variant-numeric:tabular-nums;letter-spacing:0}
.pty-meline{flex:0 0 auto;display:flex;align-items:center;gap:calc(var(--pu)*.4);padding:calc(var(--pu)*.3) max(var(--pu),env(safe-area-inset-left,0px));background:#173f34;font-size:calc(var(--pu)*.78);color:var(--rule_);min-width:0}
.pty-meline b{color:#fff;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-meline .pty-badge{flex:0 0 auto}
.pty-tbar{flex:0 0 calc(var(--pu)*.4);position:relative;background:#173f34}
.pty-tbar i{position:absolute;left:0;top:0;bottom:0;width:100%;background:var(--gold_);transform-origin:left center}
.pty-tbar.low i{background:var(--red_)}
.pty-body{flex:1 1 0;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch;padding:var(--pu) max(var(--pu),env(safe-area-inset-right,0px)) calc(var(--pu)*1.5) max(var(--pu),env(safe-area-inset-left,0px))}
.pty-col{max-width:calc(var(--pu)*34);margin:0 auto;display:flex;flex-direction:column;gap:var(--pu)}
.pty[data-lay="wide"] .pty-col{max-width:calc(var(--pu)*60)}
.pty-stack{display:flex;flex-direction:column;gap:var(--pu)}
.pty-act{flex:0 0 auto;display:flex;gap:var(--gap);align-items:stretch;padding:calc(var(--pu)*.6) max(var(--pu),env(safe-area-inset-right,0px)) calc(env(safe-area-inset-bottom,0px) + var(--pu)*.7) max(var(--pu),env(safe-area-inset-left,0px));background:var(--wall_);border-top:var(--bw) solid var(--line_)}
.pty-act:empty{display:none}
.pty-act>*{flex:1 1 0;min-width:0}
.pty-act .pty-wait{display:flex;align-items:center;justify-content:center;text-align:center;font-size:calc(var(--pu)*.9);color:var(--rule_);min-height:calc(var(--pu)*3.2)}

/* type */
.pty-kicker{margin:0;font-size:calc(var(--pu)*.75);letter-spacing:.14em;color:var(--rule_)}
.pty-h{margin:0;font-family:var(--disp_);font-size:calc(var(--pu)*1.5);line-height:1.2;color:#fff}
.pty-note{margin:0;font-size:calc(var(--pu)*.82);color:var(--rule_);line-height:1.6}
.pty-note b{color:var(--cream_)}
.pty-sign{align-self:flex-start;max-width:100%;margin:0;background:var(--formica_);color:var(--booth_);font-family:var(--disp_);font-size:calc(var(--pu)*2.6);line-height:1.05;padding:calc(var(--pu)*.45) calc(var(--pu)*.9) calc(var(--pu)*.55);border:4px solid var(--booth_);box-shadow:0 calc(var(--pu)*.25) 0 #173f34;overflow-wrap:anywhere}
.pty-sign small{display:block;font-family:var(--body_);font-size:calc(var(--pu)*.75);font-weight:700;letter-spacing:.12em;color:var(--ink_);margin-top:calc(var(--pu)*.2)}

/* buttons */
.pty-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-height:calc(var(--pu)*3.2);padding:calc(var(--pu)*.5) calc(var(--pu)*.6);background:var(--red_);color:#fff;border:var(--bw) solid var(--line_);box-shadow:0 calc(var(--pu)*.3) 0 var(--line_);font-family:var(--disp_);font-size:calc(var(--pu)*1.35);line-height:1.1;text-align:center}
.pty-btn small{font-family:var(--body_);font-size:calc(var(--pu)*.72);font-weight:700;opacity:.9}
.pty-btn.alt{background:var(--wallhi_);color:var(--cream_);font-family:var(--body_);font-size:calc(var(--pu)*1.0);font-weight:900}
.pty-btn[aria-pressed="true"]{background:var(--chalk_);color:var(--ink_)}
.pty-btn:active:not(:disabled){transform:translateY(2px);box-shadow:0 1px 0 var(--line_)}
.pty-btn:disabled{opacity:.5}

/* segmented choice (lobby settings) */
.pty-set{display:flex;flex-direction:column;gap:calc(var(--pu)*.35)}
.pty-seg{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:calc(var(--pu)*.4)}
.pty-seg button{min-height:calc(var(--pu)*2.6);padding:calc(var(--pu)*.3);background:var(--wallhi_);color:var(--cream_);border:var(--bw) solid var(--line_);box-shadow:0 calc(var(--pu)*.2) 0 var(--line_);font-weight:900;font-size:calc(var(--pu)*.9);line-height:1.2;overflow-wrap:anywhere}
.pty-seg button[aria-pressed="true"]{background:#3a7a67;color:#fff;outline:3px solid var(--formica_);outline-offset:-6px}
.pty-seg button:disabled{opacity:.75}
.pty-seg button:disabled[aria-pressed="false"]{opacity:.4}

/* chips and badges */
.pty-chips{display:flex;flex-wrap:wrap;gap:calc(var(--pu)*.3);min-width:0}
.pty-chip{display:inline-flex;align-items:center;gap:3px;max-width:100%;min-width:0;padding:1px calc(var(--pu)*.4);background:var(--wall_);color:var(--cream_);border:2px solid var(--line_);font-size:calc(var(--pu)*.78);font-weight:700;line-height:1.5}
.pty-chip span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-chip.mine{background:var(--gold_);color:var(--ink_)}
.pty-chip.off{opacity:.45}
.pty-badge{display:inline-block;padding:0 calc(var(--pu)*.3);background:var(--gold_);color:var(--ink_);border:2px solid var(--line_);font-size:calc(var(--pu)*.68);font-weight:900;line-height:1.5;white-space:nowrap}
.pty-badge.red{background:var(--red_);color:#fff}
.pty-badge.dark{background:var(--line_);color:var(--gold_)}

/* seats */
.pty-seats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap)}
.pty[data-lay="wide"] .pty-seats{grid-template-columns:repeat(4,minmax(0,1fr))}
.pty-seat{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;min-height:calc(var(--pu)*4.6);padding:calc(var(--pu)*.5) calc(var(--pu)*.6);background:var(--chalk_);color:var(--ink_);border:var(--bw) solid var(--line_);box-shadow:var(--sh);text-align:left}
.pty-seat b{font-family:var(--disp_);font-size:calc(var(--pu)*1.35);line-height:1.15}
.pty-seat span{max-width:100%;font-size:calc(var(--pu)*.85);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-seat.cpu span{color:var(--mute_);font-weight:500}
.pty-seat.mine{background:var(--gold_)}
.pty-seat em{font-style:normal;max-width:100%;font-size:calc(var(--pu)*.72);font-weight:900;color:var(--red_);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-seat:disabled{opacity:1}
.pty-seat .rdy{font-style:normal;font-size:calc(var(--pu)*.72);font-weight:900;padding:0 4px;border:2px solid var(--line_);background:#fff;color:var(--mute_)}
.pty-seat .rdy.on{background:var(--ok_);color:#fff}
.pty-seat.cpu .rdy{background:var(--grey_);color:var(--ink_)}
/* 樓面's places: a tile each, its 熄位 / 開位 switch in the corner */
.pty-slot{position:relative;display:flex;min-width:0}
.pty-slot>.pty-seat{flex:1;min-width:0}
.pty-seat.off{background:repeating-linear-gradient(-45deg,var(--chalk_) 0 8px,var(--grey_) 8px 10px)}
.pty-seat.off span{color:var(--mute_)}
.pty-slotsw{position:absolute;top:calc(var(--pu)*.4);right:calc(var(--pu)*.4);padding:2px 6px;font-size:calc(var(--pu)*.72);font-weight:900;background:#fff;color:var(--ink_);border:2px solid var(--line_);line-height:1.3}
.pty-slotsw.off{background:var(--ok_);color:#fff}
.pty-slotsw:disabled{opacity:.45}

/* the shared till (錢箱) against the round's rent */
.pty-till{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:calc(var(--pu)*.2) var(--gap);padding:calc(var(--pu)*.5) calc(var(--pu)*.7);background:#173f34;border:var(--bw) solid var(--line_);box-shadow:var(--sh)}
.pty-till div{display:flex;flex-direction:column;min-width:0}
.pty-till small{font-size:calc(var(--pu)*.7);color:var(--rule_);letter-spacing:.06em}
.pty-till b{font-size:calc(var(--pu)*1.4);line-height:1.15;color:var(--gold_);font-variant-numeric:tabular-nums;white-space:nowrap}
.pty-till div+div b{color:#ffb4a8}
.pty-till p{grid-column:1/-1;margin:0;font-size:calc(var(--pu)*.74);color:var(--rule_);line-height:1.45}
.pty-till.tight{border-color:var(--amber_)}
.pty-till.owe{background:#4a1d1d;border-color:var(--red_)}
.pty-till.owe div:first-child b{color:#ff8a7a}
.pty-till.owe p{color:#ffd6cf;font-weight:900}
.pty-bank.owe b{color:#ff8a7a}

/* the shop ladder (lobby) */
.pty-shops{display:flex;flex-direction:column;gap:calc(var(--pu)*.35)}
.pty-shop{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:calc(var(--pu)*.2) calc(var(--pu)*.5);min-width:0;padding:calc(var(--pu)*.35) calc(var(--pu)*.5);background:var(--wallhi_);color:var(--cream_);border:var(--bw) solid var(--line_);box-shadow:0 calc(var(--pu)*.2) 0 var(--line_);text-align:left}
.pty-shop .rung{display:grid;place-items:center;width:calc(var(--pu)*1.7);height:calc(var(--pu)*1.7);background:var(--line_);color:var(--gold_);font-family:var(--disp_);font-size:calc(var(--pu)*1.0)}
.pty-shop .nm{display:flex;flex-direction:column;min-width:0}
.pty-shop .nm b{font-family:var(--disp_);font-size:calc(var(--pu)*1.1);line-height:1.15}
.pty-shop .nm small{font-size:calc(var(--pu)*.7);color:var(--rule_);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-shop em{grid-column:1/-1;font-style:normal;font-size:calc(var(--pu)*.72);font-weight:900;color:var(--gold_)}
.pty-shop[aria-pressed="true"]{background:var(--formica_);color:var(--booth_);outline:3px solid var(--gold_);outline-offset:-1px}
.pty-shop[aria-pressed="true"] .nm small,.pty-shop[aria-pressed="true"] .pace{color:var(--ink_)}
.pty-shop[aria-pressed="true"] em{color:var(--booth_)}
.pty-shop:disabled{cursor:default}
.pty-shop:disabled[aria-pressed="false"]{opacity:.55}
.pty-pace{display:flex;flex-direction:column;align-items:flex-end;gap:1px}
.pty-pace .pace{display:flex;align-items:center;gap:3px;font-size:calc(var(--pu)*.62);color:var(--rule_);white-space:nowrap}
.pty-pace .pace b{color:var(--red_);letter-spacing:-.1em;font-size:calc(var(--pu)*.62)}
.pty-pace .pace i{font-style:normal;color:var(--grey_);opacity:.5;letter-spacing:-.1em;font-size:calc(var(--pu)*.62)}

/* 收舖: 執笠 */
.pty-fold{display:flex;align-items:center;gap:var(--gap);padding:calc(var(--pu)*.6);background:#4a1d1d;border:var(--bw) solid var(--red_);box-shadow:var(--sh)}
.pty-fold p{margin:0;font-size:calc(var(--pu)*.9);color:#ffd6cf;font-weight:700}

/* wager cards */
.pty-cards{display:flex;flex-direction:column;gap:var(--pu)}
.pty[data-lay="wide"] .pty-cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}
.pty-card{position:relative;display:flex;flex-direction:column;align-items:stretch;gap:calc(var(--pu)*.3);min-width:0;padding:0 0 calc(var(--pu)*.6);background:var(--chalk_);color:var(--ink_);border:var(--bw) solid var(--line_);box-shadow:var(--sh);text-align:left}
.pty-card .tier{display:flex;justify-content:space-between;align-items:baseline;gap:var(--gap);padding:calc(var(--pu)*.25) calc(var(--pu)*.6);background:var(--tc);color:#fff;border-bottom:var(--bw) solid var(--line_)}
.pty-card .tier b{font-family:var(--disp_);font-size:calc(var(--pu)*1.2)}
.pty-card .tier span{font-size:calc(var(--pu)*.8);font-weight:900;white-space:nowrap}
.pty-card .txt{padding:0 calc(var(--pu)*.6);font-family:var(--disp_);font-size:calc(var(--pu)*1.35);line-height:1.25}
.pty-card .last{padding:0 calc(var(--pu)*.6);font-size:calc(var(--pu)*.76);color:var(--mute_)}
.pty-card .warn{padding:0 calc(var(--pu)*.6);font-size:calc(var(--pu)*.76);font-weight:900;color:var(--red_)}
.pty-card .pty-chips{padding:0 calc(var(--pu)*.6);min-height:calc(var(--pu)*1.4)}
.pty-card[aria-pressed="true"]{outline:4px solid var(--gold_);outline-offset:2px}
.pty-card[aria-pressed="true"]::after{content:'你揀';position:absolute;right:calc(var(--pu)*.5);top:calc(var(--pu)*-.85);padding:0 calc(var(--pu)*.3);background:var(--gold_);border:2px solid var(--line_);font-size:calc(var(--pu)*.7);font-weight:900}
.pty-card.won{outline:4px solid var(--gold_);outline-offset:2px}
.pty-card:disabled{cursor:default}
.pty-card .x2{font-family:var(--disp_);color:var(--gold_);text-shadow:1px 1px 0 var(--line_)}

/* toggles (孤注一擲) */
.pty-toggles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap)}
.pty-tog{display:flex;flex-direction:column;align-items:flex-start;gap:2px;min-width:0;min-height:calc(var(--pu)*3.6);padding:calc(var(--pu)*.4) calc(var(--pu)*.55);background:var(--wallhi_);color:var(--cream_);border:var(--bw) solid var(--line_);box-shadow:var(--sh);text-align:left}
.pty-tog b{font-family:var(--disp_);font-size:calc(var(--pu)*1.1);line-height:1.15}
.pty-tog span{max-width:100%;font-size:calc(var(--pu)*.72);color:var(--rule_);line-height:1.35;overflow-wrap:anywhere}
.pty-tog span i{font-style:normal;display:inline-block;max-width:100%}
.pty-tog[aria-pressed="true"]{background:var(--gold_);color:var(--ink_)}
.pty-tog[aria-pressed="true"] span{color:var(--ink_)}
.pty-tog:disabled{opacity:.45}

/* panels (team line, stats) */
.pty-panel{display:flex;flex-direction:column;gap:calc(var(--pu)*.5);padding:calc(var(--pu)*.7);background:var(--wallhi_);border:var(--bw) solid var(--line_);box-shadow:var(--sh)}
.pty-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:calc(var(--pu)*.4)}
.pty[data-lay="wide"] .pty-stats{grid-template-columns:repeat(4,minmax(0,1fr))}
.pty-stat{display:flex;flex-direction:column;min-width:0;padding:calc(var(--pu)*.35) calc(var(--pu)*.5);background:#173f34;border:2px solid var(--line_);font-size:calc(var(--pu)*.72);color:var(--rule_)}
.pty-stat b{font-size:calc(var(--pu)*1.3);line-height:1.2;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-stat.wide{grid-column:span 2}
.pty-stat.up b{color:#9ff0c3}.pty-stat.down b{color:#ffb4a8}.pty-stat.gold b{color:var(--gold_)}
.pty-verdict{display:flex;align-items:center;gap:var(--gap);min-width:0}
.pty-verdict .v-main{min-width:0;flex:1 1 auto}
.pty-head{display:flex;align-items:flex-start;gap:var(--gap)}
.pty-head-main{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:2px}
.pty-secs{flex:0 0 auto;min-width:calc(var(--pu)*2.6);text-align:right}
.pty-verdict .txt{font-family:var(--disp_);font-size:calc(var(--pu)*1.15);line-height:1.25;color:#fff}
.pty-verdict .sub{font-size:calc(var(--pu)*.75);color:var(--rule_)}
.pty-verdict .amt{flex:0 0 auto;font-size:calc(var(--pu)*1.5);font-weight:900;font-variant-numeric:tabular-nums}
.pty-verdict .amt.up{color:#9ff0c3}.pty-verdict .amt.down{color:#ffb4a8}
.pty-stamp{flex:0 0 auto;display:grid;place-items:center;width:calc(var(--pu)*3.2);height:calc(var(--pu)*3.2);border:4px solid currentColor;font-family:var(--disp_);font-size:calc(var(--pu)*1.25);line-height:1;transform:rotate(-8deg)}
.pty-stamp.met{color:var(--gold_)}.pty-stamp.miss{color:#ff8a7a}.pty-stamp.none{color:var(--rule_)}

/* end-card station columns */
.pty-cols{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--gap)}
.pty[data-lay="wide"] .pty-cols{grid-template-columns:repeat(4,minmax(0,1fr))}
.pty-stn{display:flex;flex-direction:column;gap:2px;min-width:0;padding:calc(var(--pu)*.45) calc(var(--pu)*.5);background:var(--chalk_);color:var(--ink_);border:var(--bw) solid var(--line_);box-shadow:var(--sh)}
.pty-stn.mine{grid-column:1/-1;background:var(--paper_);outline:4px solid var(--gold_);outline-offset:-1px}
.pty[data-lay="wide"] .pty-stn.mine{grid-column:auto}
.pty-stn h3{margin:0;display:flex;justify-content:space-between;align-items:baseline;gap:4px;font-family:var(--disp_);font-size:calc(var(--pu)*1.15);line-height:1.2}
.pty-stn .pty-who{font-size:calc(var(--pu)*.75);color:var(--mute_);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-stn dl{margin:2px 0 0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 calc(var(--pu)*.4);font-size:calc(var(--pu)*.76)}
.pty-stn dt{color:var(--mute_);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pty-stn dd{margin:0;font-weight:900;font-variant-numeric:tabular-nums}
.pty-stn .best{font-family:var(--hand,"LXGW WenKai TC","Kaiti TC",serif);font-size:calc(var(--pu)*.85);color:var(--booth_)}
.pty-stars{font-size:calc(var(--pu)*1.0);letter-spacing:.05em;color:#e9a21a;white-space:nowrap}
.pty-stars i{font-style:normal;color:var(--grey_)}

/* countdown */
.pty-count{display:flex;flex-direction:column;align-items:center;gap:var(--pu);padding-top:calc(var(--pu)*1.5)}
.pty-count .num{display:grid;place-items:center;min-width:calc(var(--pu)*8);height:calc(var(--pu)*8);padding:0 var(--pu);background:var(--formica_);color:var(--booth_);border:5px solid var(--booth_);box-shadow:0 calc(var(--pu)*.35) 0 #173f34;font-family:var(--disp_);font-size:calc(var(--pu)*5.5);line-height:1}

/* 收舖 */
.pty-ladder{display:flex;flex-direction:column-reverse;gap:3px;margin:0;padding:0;list-style:none}
.pty-ladder li{display:flex;justify-content:space-between;align-items:center;gap:var(--gap);padding:calc(var(--pu)*.25) calc(var(--pu)*.6);background:#173f34;border:2px solid var(--line_);color:var(--rule_);font-size:calc(var(--pu)*.85)}
.pty-ladder li.lit{background:var(--wallhi_);color:var(--cream_)}
.pty-ladder li.here{background:var(--gold_);color:var(--ink_);font-family:var(--disp_);font-size:calc(var(--pu)*1.25);border-width:var(--bw)}
.pty-big{font-size:calc(var(--pu)*2.8);line-height:1;font-weight:900;color:var(--gold_);font-variant-numeric:tabular-nums;text-shadow:0 3px 0 var(--line_)}
.pty-big.owe{color:#ff8a7a}
.pty-people{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--gap)}
.pty[data-lay="wide"] .pty-people{grid-template-columns:repeat(2,minmax(0,1fr))}
.pty-person{display:flex;flex-direction:column;gap:3px;min-width:0;padding:calc(var(--pu)*.5) calc(var(--pu)*.6);background:var(--chalk_);color:var(--ink_);border:var(--bw) solid var(--line_);box-shadow:var(--sh)}
.pty-person.mine{background:var(--paper_);outline:4px solid var(--gold_);outline-offset:-1px}
.pty-person h3{margin:0;display:flex;justify-content:space-between;gap:var(--gap);font-size:calc(var(--pu)*1.0);min-width:0}
.pty-person h3 span{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pty-person h3 small{flex:0 0 auto;font-weight:500;color:var(--mute_);font-size:calc(var(--pu)*.75)}
.pty-award{display:flex;align-items:baseline;gap:calc(var(--pu)*.5);min-width:0}
.pty-award b{flex:0 0 auto;padding:0 calc(var(--pu)*.35);background:var(--booth_);color:#fff;font-family:var(--disp_);font-size:calc(var(--pu)*1.0);border:2px solid var(--line_)}
.pty-award span{min-width:0;font-size:calc(var(--pu)*.8);color:var(--mute_);overflow-wrap:anywhere}

/* toast for refusals */
.pty-toast{position:absolute;left:50%;bottom:calc(var(--pu)*6);z-index:5;max-width:calc(100% - var(--pu)*2);transform:translateX(-50%);padding:calc(var(--pu)*.4) calc(var(--pu)*.8);background:var(--line_);color:var(--gold_);border:2px solid var(--gold_);font-weight:900;font-size:calc(var(--pu)*.9);pointer-events:none}
.pty-toast[hidden]{display:none}
@media (prefers-reduced-motion:reduce){.pty *{animation:none;transition:none}}
`;
