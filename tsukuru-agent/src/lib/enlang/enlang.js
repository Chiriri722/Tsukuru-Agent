(() => {
    globalThis.loadEn = () => {
        document.documentElement.lang = 'en'
        let translated = 0
        for (const element of document.querySelectorAll('[enlang]')) {
            const value = element.getAttribute('enlang')
            if (value === null) continue
            element.textContent = value.replace(/\r/g, '')
            translated += 1
        }
        return translated
    }
})()
