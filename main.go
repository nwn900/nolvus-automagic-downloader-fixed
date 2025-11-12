package main

import (
	"context"
	"log"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
)

func main() {
	// Create a new allocator context for managing Chrome instances
	allocatorContext, allocCancel := chromedp.NewRemoteAllocator(context.Background(), "ws://localhost:8088")
	defer allocCancel()

	// Build context options (currently empty, but can be used for configuration)
	var opts []chromedp.ContextOption

	// Create a new Chrome instance using the allocator and options
	ctx, ctxCancel := chromedp.NewContext(
		allocatorContext,
		opts...,
	)
	defer ctxCancel()

	// "processBrowser" processes the browser's targets
	processBrowser := func() {
		// Retrieve the list of targets (tabs/windows) in the Chrome instance
		targets, err := chromedp.Targets(ctx)
		if err != nil {
			log.Printf("Error getting targets: %v", err)
			return
		}

		// Log all target titles for debugging
		log.Printf("Found %d targets:", len(targets))
		for i, t := range targets {
			log.Printf("  [%d] %s", i, t.Title)
		}

		// Flag to check if the target is found
		var found bool

		// Iterate through the targets to find the desired one
		for _, t := range targets {
			// More flexible search - just look for "Skyrim" and "Nexus"
			titleLower := strings.ToLower(t.Title)
			if strings.Contains(titleLower, "skyrim") && strings.Contains(titleLower, "nexus") {
				found = true
				log.Printf("Target: %s", t.Title)
				
				// Create a NEW context specifically for this target
				// Use the ALLOCATOR context as parent, not ctx
				targetCtx, targetCancel := chromedp.NewContext(
					allocatorContext, 
					chromedp.WithTargetID(t.TargetID),
				)
				// We'll clean this up at the end of processing this target
				
				// Check if an ad is visible
				var adVisible bool
				err := chromedp.Run(targetCtx,
					chromedp.Evaluate(`!!document.querySelector('input.close-btn[type="checkbox"]')`, &adVisible),
				)

				// Log error without exiting
				if err != nil {
					log.Printf("Error checking for ad popup: %s", err.Error())
				}

				// If an ad is visible, close it
				if adVisible {
					err = chromedp.Run(targetCtx,
						chromedp.WaitVisible(`input.close-btn[type="checkbox"]`, chromedp.ByQuery),
						chromedp.Click(`input.close-btn[type="checkbox"]`, chromedp.ByQuery),
					)
					
					if err != nil {
						log.Printf("Could not close ad popup: %s", err.Error())
					} else {
						log.Println("Closed ad popup successfully")
						time.Sleep(500 * time.Millisecond) // Brief pause after closing ad
					}
				}

				// First, let's debug what's in the shadow root
				var debugInfo string
				err = chromedp.Run(targetCtx,
					chromedp.EvaluateAsDevTools(`
						(() => {
							const host = document.querySelector("mod-file-download");
							if (!host) return "Host element 'mod-file-download' not found";
							if (!host.shadowRoot) return "ShadowRoot not found on host";
							
							// Try to find the button with different selectors
							const btn1 = host.shadowRoot.querySelector("button");
							const btn2 = host.shadowRoot.querySelector("button span");
							const btn3 = host.shadowRoot.querySelector("button span span");
							
							return JSON.stringify({
								hasButton: !!btn1,
								hasButtonSpan: !!btn2,
								hasButtonSpanSpan: !!btn3,
								buttonHTML: btn1 ? btn1.outerHTML.substring(0, 200) : "none",
								allButtons: host.shadowRoot.querySelectorAll("button").length
							});
						})()
					`, &debugInfo),
				)
				
				if err != nil {
					log.Printf("Error debugging shadow root: %v", err)
				} else {
					log.Printf("Shadow root debug info: %s", debugInfo)
				}

				// Now try clicking with multiple selector strategies
				var clicked bool
				err = chromedp.Run(targetCtx,
					chromedp.EvaluateAsDevTools(`
						(() => {
							const host = document.querySelector("mod-file-download");
							if (!host || !host.shadowRoot) return false;
							
							// Try different selectors
							let btn = host.shadowRoot.querySelector("button span span");
							if (!btn) btn = host.shadowRoot.querySelector("button span");
							if (!btn) btn = host.shadowRoot.querySelector("button");
							
							if (!btn) return false;
							
							btn.click();
							return true;
						})()
					`, &clicked),
				)
				
				if err != nil {
					log.Printf("Error clicking download button: %v", err)
				} else if clicked {
					log.Println("Clicked download button successfully!")
					time.Sleep(2 * time.Second)
				} else {
					log.Println("Download button not found inside shadow root")
				}

				// Clean up the target context after ALL operations are done
				targetCancel()
				break // Exit the loop once we've processed the target
			}
		}

		// Log if no target was found
		if !found {
			log.Printf("No target found")
		}
	}

	// Continuously process the browser
	for {
		processBrowser()
		time.Sleep(5 * time.Second)
	}
}
