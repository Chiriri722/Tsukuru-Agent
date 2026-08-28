(() => {
    const ipc = window.tsukuru
    const mainMenu = document.querySelector('#mainMenu') as HTMLDivElement
    
    let globalSettings
    
    ipc.on('getGlobalSettings', (tt) => {
        globalSettings = tt
        if(tt.language === 'en'){
            document.getElementById('lang-en').classList.add('btxSel')            
            globalThis.loadEn()
        }
        else{
            document.getElementById('lang-ko').classList.add('btxSel')
        }
        const tData = (globalSettings.themeData)
        let root = document.documentElement;
        for(const i in tData){
            root.style.setProperty(i,tData[i]);
        }
    })
    
    document.getElementById('icon1').onclick = () => {ipc.send('close')}
    document.getElementById('icon2').onclick = () => {ipc.send('minimize')}
    document.getElementById('gokupu').onclick = () => {ipc.send('changeURL', 'rpg')}
    document.getElementById('simpuru').onclick = () => {ipc.send('changeURL', 'wolf')}
    document.getElementById('lang-en').onclick = () => {ipc.send('changeLang', 'en')}
    document.getElementById('lang-ko').onclick = () => {ipc.send('changeLang', 'ko')}

    ipc.on('set_path', (tt) => {
        (document.getElementById(tt.type) as HTMLInputElement).value = tt.dir
        if(tt.type !== 'folder_input'){
            document.getElementById(tt.type).innerText = tt.dir
        }
    });
    mainMenu.style.display = 'block'

    ipc.on('alert_free', (tt) => {
        //@ts-ignore
        Swal.fire(tt)
    });
})()
