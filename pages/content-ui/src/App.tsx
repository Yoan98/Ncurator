import { useEffect } from 'react';
import { Button } from '@extension/ui';
import { useStorage } from '@extension/shared';
import { exampleThemeStorage } from '@extension/storage';
import html2canvas from 'html2canvas'

export default function App() {
    const theme = useStorage(exampleThemeStorage);

    const screenshot = async () => {
        const element = document.getElementsByClassName('dashboard-sidebar')[0]
        console.log('element', element);


        const canvas = await html2canvas(element);
        const img = canvas.toDataURL('image/png');
        chrome.runtime.sendMessage({
            action: "sendMessage",
            data: {
                action: 'screenshot',
                data: img
            }
        });
    }

    useEffect(() => {
        console.log('content ui loaded');

    }, []);

    return (
        <div className="fixed bottom-0 left-0 w-full z-[99999] flex items-center justify-between gap-2 rounded bg-blue-100 px-2 py-1 ">
            <div className="flex gap-1 text-blue-500">
                Edit <strong className="text-blue-700">pages/content-ui/src/app.tsx</strong> and save to reload.
            </div>
            <Button theme={theme} onClick={screenshot}>
                Toggle Theme
            </Button>
        </div>
    );
}
