import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import StadiumIcon from "@mui/icons-material/Stadium";
import { useNavigate, useParams } from "react-router-dom";
import type { VenueOwnerView } from "@eventer/shared";
import {
  useCreateVenue,
  useDeleteVenue,
  useUpdateVenue,
  useVenue,
} from "../api/venueHooks.js";
import { CounterTextField } from "../components/CounterTextField.js";
import { VenueAdminsCard } from "../components/VenueAdminsCard.js";

/** 会場の登録/編集（オーナー・管理者）。/venues/new と /venues/:id/edit 兼用 */
export function VenueFormPage() {
  const { id = "" } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const create = useCreateVenue();
  const update = useUpdateVenue(id);
  const del = useDeleteVenue();
  const existing = useVenue(isEdit ? id : "");

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [area, setArea] = useState("");
  const [address, setAddress] = useState("");
  const [addressPublic, setAddressPublic] = useState(false);
  const [capacity, setCapacity] = useState("");
  const [equipment, setEquipment] = useState("");
  const [terms, setTerms] = useState("");
  const [contact, setContact] = useState("");
  const [open, setOpen] = useState(true);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // 編集時は既存値をロード（1回だけ）
  const loaded = useRef(false);
  useEffect(() => {
    const v = existing.data?.venue as VenueOwnerView | undefined;
    if (!isEdit || !v || loaded.current) return;
    if (!(existing.data?.isManager ?? existing.data?.isOwner)) return;
    loaded.current = true;
    setName(v.name);
    setDescription(v.description);
    setArea(v.area);
    setAddress(v.address);
    setAddressPublic(v.addressPublic);
    setCapacity(v.capacity != null ? String(v.capacity) : "");
    setEquipment(v.equipment);
    setTerms(v.terms);
    setContact(v.contact ?? "");
    setOpen(v.status === "open");
  }, [existing.data, isEdit]);

  if (
    isEdit &&
    existing.data &&
    !(existing.data.isManager ?? existing.data.isOwner)
  ) {
    return <Alert severity="info">この会場の編集権限がありません。</Alert>;
  }

  const pickImage = (file: File | null) => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageBlob(file);
    setImagePreview(file ? URL.createObjectURL(file) : null);
  };

  const input = {
    name,
    description,
    area,
    address,
    addressPublic,
    capacity: capacity ? Number(capacity) : null,
    equipment,
    terms,
    contact,
  };

  /** 成功なら true。失敗を握りつぶさない（テキストは保存済みの旨を出す） */
  const uploadImage = async (venueId: string): Promise<boolean> => {
    if (!imageBlob) return true;
    try {
      const res = await fetch(`/api/venues/${venueId}/image`, {
        method: "PUT",
        headers: { "Content-Type": imageBlob.type },
        credentials: "include",
        body: imageBlob,
      });
      return res.ok;
    } catch {
      return false;
    }
  };

  const [imageError, setImageError] = useState<string | null>(null);
  // 作成後に写真だけ失敗したとき、再submitで会場を二重作成しないための保存済みID
  const [savedId, setSavedId] = useState<string | null>(null);

  const afterSave = async (venueId: string) => {
    setSavedId(venueId);
    if (await uploadImage(venueId)) {
      navigate(`/venues/${venueId}`);
    } else {
      setImageError(
        "会場情報は保存されましたが、写真のアップロードに失敗しました。6MB以下の JPEG/PNG/WebP で再試行してください。",
      );
    }
  };

  const submit = () => {
    setImageError(null);
    if (isEdit) {
      update.mutate(
        { ...input, status: open ? "open" : "closed" },
        { onSuccess: () => void afterSave(id) },
      );
    } else {
      create.mutate(input, {
        onSuccess: ({ venue }) => void afterSave(venue.id),
      });
    }
  };

  const pending = create.isPending || update.isPending;

  return (
    <Stack spacing={3} sx={{ maxWidth: 760 }}>
    <Card variant="outlined">
      <CardContent>
        <Typography
          variant="h5"
          fontWeight={700}
          gutterBottom
          sx={{ display: "flex", alignItems: "center", gap: 0.75 }}
        >
          {!isEdit && <StadiumIcon fontSize="medium" />}
          {isEdit ? "会場を編集" : "会場を登録"}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          イベント主催者に使ってもらえる会場を登録します。連絡先はマッチング成立まで公開されません。
        </Typography>
        <Stack spacing={2.5}>
          <CounterTextField
            label="会場名"
            value={name}
            max={100}
            onChange={(e) => setName(e.target.value)}
            required
            fullWidth
          />
          <CounterTextField
            label="紹介（任意）"
            value={description}
            max={4000}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={3}
            fullWidth
            helperText="Markdown が使えます。雰囲気・アクセス・利用例など"
          />
          <CounterTextField
            label="エリア"
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder="例: 東京都渋谷区"
            value={area}
            max={100}
            onChange={(e) => setArea(e.target.value)}
            required
            fullWidth
            helperText="一覧・詳細に公開される場所情報"
          />
          <CounterTextField
            label="詳細住所（任意）"
            value={address}
            max={300}
            onChange={(e) => setAddress(e.target.value)}
            fullWidth
          />
          <FormControlLabel
            control={
              <Switch
                checked={addressPublic}
                onChange={(e) => setAddressPublic(e.target.checked)}
              />
            }
            label="詳細住所を公開する（OFF: マッチング成立後にのみ開示）"
          />
          <TextField
            label="収容人数（任意）"
            type="number"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            sx={{ maxWidth: 200 }}
          />
          <CounterTextField
            label="設備（任意）"
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder="Wi-Fi / プロジェクター / ホワイトボード など"
            value={equipment}
            max={1000}
            onChange={(e) => setEquipment(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <CounterTextField
            label="提供条件（任意）"
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder="平日夜と週末のみ / 飲食可 / 原状回復お願いします など"
            value={terms}
            max={2000}
            onChange={(e) => setTerms(e.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
          <CounterTextField
            label="連絡先（マッチング相手にのみ開示）"
            slotProps={{ inputLabel: { shrink: true } }}
            placeholder="X: @xxx / Discord: xxx / メール等"
            value={contact}
            max={500}
            onChange={(e) => setContact(e.target.value)}
            fullWidth
          />
          <div>
            <Button variant="outlined" onClick={() => fileInput.current?.click()}>
              カバー写真を選択
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
            />
            {imagePreview && (
              <img
                src={imagePreview}
                alt="プレビュー"
                style={{ display: "block", marginTop: 8, maxWidth: "100%", borderRadius: 8 }}
              />
            )}
          </div>
          {isEdit && (
            <FormControlLabel
              control={
                <Switch checked={open} onChange={(e) => setOpen(e.target.checked)} />
              }
              label="提供を受け付ける"
            />
          )}
          {(create.isError || update.isError) && (
            <Alert severity="error">保存に失敗しました。入力内容を確認してください。</Alert>
          )}
          {imageError && savedId && (
            <Alert
              severity="warning"
              action={
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    onClick={() => {
                      setImageError(null);
                      void afterSave(savedId);
                    }}
                  >
                    再試行
                  </Button>
                  <Button size="small" onClick={() => navigate(`/venues/${savedId}`)}>
                    写真なしで進む
                  </Button>
                </Stack>
              }
            >
              {imageError}
            </Alert>
          )}
          <Stack direction="row" spacing={1.5}>
            <Button
              variant="contained"
              onClick={submit}
              disabled={!name.trim() || !area.trim() || pending}
            >
              {isEdit ? "保存" : "登録する"}
            </Button>
            <Button onClick={() => navigate(-1)}>キャンセル</Button>
            {isEdit && (
              <Button
                color="error"
                sx={{ ml: "auto" }}
                onClick={() => {
                  if (window.confirm("この会場を削除しますか？")) {
                    del.mutate(id, { onSuccess: () => navigate("/venues") });
                  }
                }}
              >
                削除
              </Button>
            )}
          </Stack>
        </Stack>
      </CardContent>
    </Card>
    {isEdit && existing.data?.isOwner && <VenueAdminsCard venueId={id} />}
    </Stack>
  );
}
