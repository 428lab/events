import {Alert,FormControl,FormControlLabel,FormLabel,Radio,RadioGroup,Stack} from "@mui/material";
import type {Event} from "@eventer/shared";
import {useTranslation} from "react-i18next";
export function EventVisibilityField({value,onChange,locked=false}:{value:Event["visibility"];onChange:(v:Event["visibility"])=>void;locked?:boolean}) {
  const {t}=useTranslation();
  return <Stack spacing={1}><FormControl disabled={locked}><FormLabel>{t("eventAccess.visibility")}</FormLabel>
    <RadioGroup row value={value} onChange={(_,v)=>onChange(v as Event["visibility"])}>
      <FormControlLabel value="public" control={<Radio/>} label={t("eventAccess.public")}/>
      <FormControlLabel value="unlisted" control={<Radio/>} label={t("eventAccess.unlisted")}/>
      <FormControlLabel value="private" control={<Radio/>} label={t("eventAccess.private")}/>
    </RadioGroup></FormControl>
    {locked && <Alert severity="info">{t("eventAccess.legacyLocked")}</Alert>}
    {value!=="public" && <><Alert severity="info">{t("eventAccess.chatPrivacy")}</Alert><Alert severity="warning">{t("eventAccess.materialPrivacy")}</Alert></>}
  </Stack>;
}
