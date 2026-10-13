# blueprint prototype (reference only)

throwaway design-session code. see CONTEXT.md section 22 for what each file is.

quick start:
  cd parser && npm i          # pins typescript 5.9, build scripts resolve it from here
  cd ../feat && node build3.js   # regenerates data.json from before/ and after/
  open feat/out_e.html        # the plan map (self-contained)
  cd ../m2 && python3 build.py   # rebuilds the surface mocks (out_a..d.html)

names still say "storyline". staged bits: the refundHandler -> recordAudit plan arrow, mock chat text, the hand-written LAYOUT.
